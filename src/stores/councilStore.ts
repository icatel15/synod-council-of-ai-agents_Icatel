import { create, type StoreApi } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  CouncilState,
  DiscussionEntry,
  DiscussionDepth,
  DiscussionMode,
  ModelConfig,
  MasterModelConfig,
  ChatMessage,
  ClarifyingExchange,
  Provider,
  UsageData,
} from '../types';
import * as tauri from '../lib/tauri';

interface CouncilStoreState {
  state: CouncilState;
  currentModelIndex: number;
  currentStreamId: string | null;
  currentStreamContent: string;
  systemPrompts: Map<string, string>;
  clarifyingExchanges: ClarifyingExchange[];
  waitingForClarification: boolean;
  followUpInProgress: boolean;
  error: string | null;

  // Parallel mode state
  parallelStreams: Record<number, string>;
  parallelStreamIds: Record<number, string>;
  parallelCompletedCount: number;
  parallelTotalCount: number;

  // Actions
  startDiscussion: (
    userQuestion: string,
    models: ModelConfig[],
    masterModel: MasterModelConfig,
    systemPromptMode: 'upfront' | 'dynamic',
    discussionDepth: DiscussionDepth,
    discussionMode: DiscussionMode,
    getApiKey: (service: string) => Promise<string | null>,
    onEntryComplete: (entry: DiscussionEntry) => void,
  ) => Promise<void>;

  sendFollowUp: (
    targetProvider: string,
    targetModel: string,
    targetDisplayName: string,
    followUpQuestion: string,
    discussionEntries: DiscussionEntry[],
    getApiKey: (service: string) => Promise<string | null>,
    onEntryComplete: (entry: DiscussionEntry) => void,
  ) => Promise<void>;

  submitClarification: (answer: string) => void;
  reset: () => void;
}

export const useCouncilStore = create<CouncilStoreState>((set, get) => ({
  state: 'idle',
  currentModelIndex: -1,
  currentStreamId: null,
  currentStreamContent: '',
  systemPrompts: new Map(),
  clarifyingExchanges: [],
  waitingForClarification: false,
  followUpInProgress: false,
  error: null,
  parallelStreams: {},
  parallelStreamIds: {},
  parallelCompletedCount: 0,
  parallelTotalCount: 0,

  startDiscussion: async (
    userQuestion,
    models,
    masterModel,
    systemPromptMode,
    discussionDepth,
    discussionMode,
    getApiKey,
    onEntryComplete,
  ) => {
    set({ state: 'user_input', error: null });

    // Add user entry
    onEntryComplete({ role: 'user', content: userQuestion });

    // Branch: parallel mode uses a completely different flow
    if (discussionMode === 'parallel') {
      await runParallelDiscussion(
        userQuestion, models, masterModel, discussionDepth, getApiKey, onEntryComplete, set, get,
      );
      return;
    }

    const discussionSoFar: DiscussionEntry[] = [
      { role: 'user', content: userQuestion },
    ];

    // Track master model usage across prompt generation + verdict
    let masterPromptGenUsage: UsageData | undefined;

    // Generate system prompts if upfront mode
    if (systemPromptMode === 'upfront') {
      set({ state: 'generating_system_prompts' });
      try {
        const masterApiKey = await getApiKey(
          `com.council-of-ai-agents.${masterModel.provider}`,
        );
        if (!masterApiKey) {
          set({ state: 'error', error: `No API key found for master model provider (${masterModel.provider})` });
          return;
        }

        const promptGenMessages: ChatMessage[] = [
          {
            role: 'user',
            content: `You are the orchestrator of a council of AI models helping a user make an informed decision. The user's question is:

"${userQuestion}"

The following AI models will discuss this question in order:
${models.map((m, i) => `${i + 1}. ${m.displayName} (${m.provider})`).join('\n')}

Generate a specific, tailored system prompt for EACH council model that helps them provide their best analysis. The first model (${models[0]?.displayName}) should be instructed that it MAY ask up to 2 clarifying questions if needed. All other models should be told they CANNOT ask questions.

Each model should be encouraged to provide unique perspectives and not just repeat previous opinions.
${discussionDepth === 'concise' ? '\nIMPORTANT: Instruct each model to keep responses brief and focused — 2-3 key points maximum. No lengthy explanations.\n' : ''}
Return your response in this exact JSON format:
${JSON.stringify(
  models.reduce(
    (acc, m) => ({
      ...acc,
      [`${m.provider}:${m.model}`]: 'system prompt here',
    }),
    {},
  ),
  null,
  2,
)}`,
          },
        ];

        const streamId = uuidv4();
        const unlisten = await tauri.onStreamToken(streamId, (token) => {
          if (!token.done) {
            set((s) => ({
              currentStreamContent: s.currentStreamContent + token.token,
            }));
          }
        });

        set({ currentStreamId: streamId, currentStreamContent: '' });

        const result = await tauri.streamChat(
          masterModel.provider,
          masterModel.model,
          promptGenMessages,
          'You are an AI orchestrator. Generate system prompts for council models. Return valid JSON only.',
          masterApiKey,
          streamId,
        );

        unlisten();
        set({ currentStreamId: null, currentStreamContent: '' });
        masterPromptGenUsage = result.usage;

        // Parse the JSON response
        try {
          const jsonMatch = result.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const prompts = JSON.parse(jsonMatch[0]);
            const promptMap = new Map<string, string>();
            for (const [key, value] of Object.entries(prompts)) {
              promptMap.set(key, value as string);
            }
            set({ systemPrompts: promptMap });
          }
        } catch {
          // If JSON parsing fails, continue without custom prompts
          console.warn('Failed to parse system prompts, using defaults');
        }
      } catch (err) {
        set({
          state: 'error',
          error: `Failed to generate system prompts: ${err}`,
        });
        return;
      }
    }

    // Process each model sequentially
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      set({ state: 'model_turn', currentModelIndex: i });

      try {
        const apiKey = await getApiKey(
          `com.council-of-ai-agents.${model.provider}`,
        );
        if (!apiKey) {
          set({
            state: 'error',
            error: `No API key found for ${model.displayName} (${model.provider})`,
          });
          return;
        }

        // Build messages context
        const messages: ChatMessage[] = buildContextMessages(
          userQuestion,
          discussionSoFar,
          i === 0,
        );

        // Get system prompt
        const systemPromptKey = `${model.provider}:${model.model}`;
        let systemPrompt =
          get().systemPrompts.get(systemPromptKey) || getDefaultSystemPrompt(model, i === 0, discussionDepth);

        // Dynamic mode: generate prompt for this model
        if (systemPromptMode === 'dynamic' && i > 0) {
          try {
            const masterApiKey = await getApiKey(
              `com.council-of-ai-agents.${masterModel.provider}`,
            );
            if (masterApiKey) {
              const dynamicStreamId = uuidv4();
              const dynamicUnlisten = await tauri.onStreamToken(
                dynamicStreamId,
                () => {},
              );
              const dynamicResult = await tauri.streamChat(
                masterModel.provider,
                masterModel.model,
                [
                  {
                    role: 'user',
                    content: `Generate a system prompt for ${model.displayName} to analyze: "${userQuestion}". Previous discussion: ${JSON.stringify(discussionSoFar)}. The model should provide a unique perspective. Return only the system prompt text, no JSON.`,
                  },
                ],
                'Generate a concise system prompt. Return only the prompt text.',
                masterApiKey,
                dynamicStreamId,
              );
              dynamicUnlisten();
              systemPrompt = dynamicResult.content;
              // Accumulate dynamic prompt gen usage with master usage
              if (dynamicResult.usage) {
                if (!masterPromptGenUsage) {
                  masterPromptGenUsage = { inputTokens: 0, outputTokens: 0 };
                }
                masterPromptGenUsage.inputTokens += dynamicResult.usage.inputTokens;
                masterPromptGenUsage.outputTokens += dynamicResult.usage.outputTokens;
              }
            }
          } catch {
            // Fall back to default prompt
          }
        }

        // Stream the model's response
        const streamId = uuidv4();
        set({ currentStreamId: streamId, currentStreamContent: '' });

        const unlisten = await tauri.onStreamToken(streamId, (token) => {
          if (!token.done && !token.error) {
            set((s) => ({
              currentStreamContent: s.currentStreamContent + token.token,
            }));
          }
        });

        const result = await tauri.streamChat(
          model.provider,
          model.model,
          messages,
          systemPrompt,
          apiKey,
          streamId,
        );

        unlisten();
        set({ currentStreamId: null, currentStreamContent: '' });

        // Check if first model asked a clarifying question
        if (i === 0 && looksLikeClarifyingQuestion(result.content)) {
          set({
            state: 'clarifying_qa',
            waitingForClarification: true,
            clarifyingExchanges: [{ question: result.content, answer: '' }],
          });

          // Wait for user's clarification answer
          await new Promise<void>((resolve) => {
            const checkInterval = setInterval(() => {
              const current = get();
              if (!current.waitingForClarification) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 200);
          });

          const exchanges = get().clarifyingExchanges;
          const clarifyAnswer = exchanges[exchanges.length - 1]?.answer;

          if (clarifyAnswer) {
            // Get follow-up response from the first model
            const followUpMessages: ChatMessage[] = [
              ...messages,
              { role: 'assistant', content: result.content },
              { role: 'user', content: clarifyAnswer },
            ];

            const followUpStreamId = uuidv4();
            set({
              state: 'model_turn',
              currentStreamId: followUpStreamId,
              currentStreamContent: '',
            });

            const followUpUnlisten = await tauri.onStreamToken(
              followUpStreamId,
              (token) => {
                if (!token.done && !token.error) {
                  set((s) => ({
                    currentStreamContent: s.currentStreamContent + token.token,
                  }));
                }
              },
            );

            const followUpResult = await tauri.streamChat(
              model.provider,
              model.model,
              followUpMessages,
              systemPrompt,
              apiKey,
              followUpStreamId,
            );

            followUpUnlisten();
            set({ currentStreamId: null, currentStreamContent: '' });

            // Combine initial question usage + follow-up usage
            const combinedUsage = combineUsage(result.usage, followUpResult.usage);

            const entry: DiscussionEntry = {
              role: 'model',
              provider: model.provider,
              model: model.model,
              displayName: model.displayName,
              systemPrompt,
              content: followUpResult.content,
              clarifyingExchange: exchanges.map((e) => ({
                question: e.question,
                answer: e.answer,
              })),
              usage: combinedUsage,
            };
            discussionSoFar.push(entry);
            onEntryComplete(entry);
          }
        } else {
          const entry: DiscussionEntry = {
            role: 'model',
            provider: model.provider,
            model: model.model,
            displayName: model.displayName,
            systemPrompt,
            content: result.content,
            usage: result.usage,
          };
          discussionSoFar.push(entry);
          onEntryComplete(entry);
        }
      } catch (err) {
        // Add error entry and continue to next model
        const entry: DiscussionEntry = {
          role: 'model',
          provider: model.provider,
          model: model.model,
          displayName: model.displayName,
          content: `[Error: Failed to get response - ${err}]`,
        };
        discussionSoFar.push(entry);
        onEntryComplete(entry);
      }
    }

    // Master verdict
    set({ state: 'master_verdict', currentModelIndex: -1 });

    try {
      const masterApiKey = await getApiKey(
        `com.council-of-ai-agents.${masterModel.provider}`,
      );
      if (!masterApiKey) {
        set({
          state: 'error',
          error: `No API key found for master model (${masterModel.provider})`,
        });
        return;
      }

      const verdictMessages: ChatMessage[] = [
        {
          role: 'user',
          content: buildMasterVerdictPrompt(userQuestion, discussionSoFar),
        },
      ];

      const streamId = uuidv4();
      set({ currentStreamId: streamId, currentStreamContent: '' });

      const unlisten = await tauri.onStreamToken(streamId, (token) => {
        if (!token.done && !token.error) {
          set((s) => ({
            currentStreamContent: s.currentStreamContent + token.token,
          }));
        }
      });

      const masterSystemPrompt = discussionDepth === 'concise'
        ? `You are the master AI judge in a council of AI models. You have reviewed all council members' opinions on the user's question. Deliver a brief, focused verdict in 3-5 sentences. Highlight only the key takeaway and recommended action. No lengthy sections.`
        : `You are the master AI judge in a council of AI models. You have reviewed all council members' opinions on the user's question. Your job is to synthesize the best advice, resolve any disagreements, and deliver a clear, actionable final verdict. Be thorough but concise. Structure your response with clear sections.`;

      const verdictResult = await tauri.streamChat(
        masterModel.provider,
        masterModel.model,
        verdictMessages,
        masterSystemPrompt,
        masterApiKey,
        streamId,
      );

      unlisten();
      set({ currentStreamId: null, currentStreamContent: '' });

      // Combine prompt generation usage + verdict usage for master model total
      const masterTotalUsage = combineUsage(masterPromptGenUsage, verdictResult.usage);

      const verdictEntry: DiscussionEntry = {
        role: 'master_verdict',
        provider: masterModel.provider,
        model: masterModel.model,
        content: verdictResult.content,
        usage: masterTotalUsage,
      };
      onEntryComplete(verdictEntry);

      set({ state: 'complete' });
    } catch (err) {
      set({ state: 'error', error: `Master verdict failed: ${err}` });
    }
  },

  sendFollowUp: async (
    targetProvider,
    targetModel,
    targetDisplayName,
    followUpQuestion,
    discussionEntries,
    getApiKey,
    onEntryComplete,
  ) => {
    set({
      state: 'follow_up',
      followUpInProgress: true,
      error: null,
    });

    // Emit the follow-up question entry
    onEntryComplete({
      role: 'follow_up_question',
      content: followUpQuestion,
      targetProvider,
      targetModel,
      targetDisplayName,
    });

    try {
      const apiKey = await getApiKey(
        `com.council-of-ai-agents.${targetProvider}`,
      );
      if (!apiKey) {
        set({
          state: 'error',
          followUpInProgress: false,
          error: `No API key found for ${targetDisplayName} (${targetProvider})`,
        });
        return;
      }

      // Build messages with full discussion context
      const messages = buildFollowUpMessages(discussionEntries, followUpQuestion);

      const systemPrompt =
        `You are ${targetDisplayName}, part of an AI council discussion. You have access to the full discussion including all council members' responses and the master verdict. The user has a follow-up question directed at you. Answer helpfully, referencing any part of the discussion as needed. Be direct and concise.`;

      const streamId = uuidv4();
      set({ currentStreamId: streamId, currentStreamContent: '' });

      const unlisten = await tauri.onStreamToken(streamId, (token) => {
        if (!token.done && !token.error) {
          set((s) => ({
            currentStreamContent: s.currentStreamContent + token.token,
          }));
        }
      });

      const result = await tauri.streamChat(
        targetProvider as Provider,
        targetModel,
        messages,
        systemPrompt,
        apiKey,
        streamId,
      );

      unlisten();
      set({ currentStreamId: null, currentStreamContent: '' });

      // Emit the follow-up answer entry
      onEntryComplete({
        role: 'follow_up_answer',
        provider: targetProvider,
        model: targetModel,
        displayName: targetDisplayName,
        content: result.content,
        usage: result.usage,
      });

      set({ state: 'complete', followUpInProgress: false });
    } catch (err) {
      // Emit error entry and recover to complete state
      onEntryComplete({
        role: 'follow_up_answer',
        provider: targetProvider,
        model: targetModel,
        displayName: targetDisplayName,
        content: `[Error: Failed to get follow-up response - ${err}]`,
      });
      set({ state: 'complete', followUpInProgress: false, currentStreamId: null, currentStreamContent: '' });
    }
  },

  submitClarification: (answer) => {
    set((s) => {
      const exchanges = [...s.clarifyingExchanges];
      if (exchanges.length > 0) {
        exchanges[exchanges.length - 1].answer = answer;
      }
      return {
        clarifyingExchanges: exchanges,
        waitingForClarification: false,
      };
    });
  },

  reset: () => {
    set({
      state: 'idle',
      currentModelIndex: -1,
      currentStreamId: null,
      currentStreamContent: '',
      systemPrompts: new Map(),
      clarifyingExchanges: [],
      waitingForClarification: false,
      followUpInProgress: false,
      error: null,
      parallelStreams: {},
      parallelStreamIds: {},
      parallelCompletedCount: 0,
      parallelTotalCount: 0,
    });
  },
}));

function buildContextMessages(
  userQuestion: string,
  discussionSoFar: DiscussionEntry[],
  isFirstModel: boolean,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'user', content: userQuestion },
  ];

  if (!isFirstModel) {
    const previousOpinions = discussionSoFar
      .filter((e): e is Extract<DiscussionEntry, { role: 'model' }> => e.role === 'model')
      .map(
        (e) =>
          `--- ${e.displayName} (${e.provider}) ---\n${e.content}`,
      )
      .join('\n\n');

    if (previousOpinions) {
      messages.push({
        role: 'user',
        content: `Here are the previous council members' opinions:\n\n${previousOpinions}\n\nPlease provide your own analysis and verdict. You may agree or disagree with previous opinions, but provide your own reasoning.`,
      });
    }
  }

  return messages;
}

function getDefaultSystemPrompt(model: ModelConfig, isFirst: boolean, depth: DiscussionDepth = 'thorough'): string {
  const depthInstruction = depth === 'concise'
    ? 'Be concise and direct. Provide 2-3 key points maximum. Skip lengthy explanations and focus on actionable insights.'
    : 'Be thorough, factual, and specific.';

  if (isFirst) {
    return `You are ${model.displayName}, a member of an AI council helping a user make an informed decision. You are the FIRST model to respond. You may ask up to 2 brief clarifying questions if the user's question is ambiguous or missing important details. If the question is clear enough, proceed directly with your analysis and recommendation. ${depthInstruction}`;
  }
  return `You are ${model.displayName}, a member of an AI council helping a user make an informed decision. You will see the user's question and previous council members' responses. Provide your own unique perspective and analysis. Do NOT ask any questions to the user. ${depthInstruction} If you agree with previous members, explain why. If you disagree, explain your reasoning.`;
}

function looksLikeClarifyingQuestion(response: string): boolean {
  const questionIndicators = [
    'before I provide my recommendation',
    'could you clarify',
    'I have a few questions',
    'let me ask',
    'to help narrow down',
    'could you tell me',
    'what is your preference',
    'do you have a preference',
  ];
  const lowerResponse = response.toLowerCase();
  return questionIndicators.some((indicator) =>
    lowerResponse.includes(indicator),
  ) && response.includes('?');
}

function combineUsage(a?: UsageData, b?: UsageData): UsageData | undefined {
  if (!a && !b) return undefined;
  return {
    inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
  };
}

function buildFollowUpMessages(
  entries: DiscussionEntry[],
  followUpQuestion: string,
): ChatMessage[] {
  // Extract original user question
  const userEntry = entries.find(e => e.role === 'user');
  const originalQuestion = userEntry?.content ?? '';

  // Build formatted summary of the full discussion
  const parts: string[] = [];
  for (const entry of entries) {
    if (entry.role === 'model') {
      parts.push(`--- ${entry.displayName} (${entry.provider}) ---\n${entry.content}`);
    }
    if (entry.role === 'master_verdict') {
      parts.push(`--- Master Verdict ---\n${entry.content}`);
    }
    if (entry.role === 'follow_up_question') {
      parts.push(`--- Follow-up to ${entry.targetDisplayName} ---\n${entry.content}`);
    }
    if (entry.role === 'follow_up_answer') {
      parts.push(`--- ${entry.displayName} (Follow-up Response) ---\n${entry.content}`);
    }
  }

  return [
    { role: 'user', content: originalQuestion },
    { role: 'assistant', content: `Here is the full council discussion:\n\n${parts.join('\n\n')}` },
    { role: 'user', content: followUpQuestion },
  ];
}

function buildMasterVerdictPrompt(
  userQuestion: string,
  discussion: DiscussionEntry[],
): string {
  const opinions = discussion
    .filter((e) => e.role === 'model')
    .map((e) => {
      const m = e as Extract<DiscussionEntry, { role: 'model' }>;
      return `--- ${m.displayName} ---\n${m.content}`;
    })
    .join('\n\n');

  return `The user asked: "${userQuestion}"

The following AI council members have provided their analysis:

${opinions}

As the master judge, please synthesize all opinions and deliver your FINAL VERDICT. Consider:
1. Points of agreement across models
2. Points of disagreement and which position is stronger
3. Any factual errors in the responses
4. A clear, actionable recommendation

Provide your final verdict with clear reasoning.`;
}

function getDefaultParallelPrompt(model: ModelConfig, depth: DiscussionDepth): string {
  const depthInstruction = depth === 'concise'
    ? 'Be concise and direct. Provide 2-3 key points maximum. Skip lengthy explanations and focus on actionable insights.'
    : 'Be thorough, factual, and specific.';

  return `You are ${model.displayName}, a member of an AI council helping a user make an informed decision. You are responding INDEPENDENTLY — you will NOT see other council members' responses. Provide your own unique perspective, analysis, and recommendation based solely on the user's question. ${depthInstruction}`;
}

// ─── Parallel Discussion Flow ─────────────────────────────────────────
// Dispatches all council models simultaneously. Each model responds
// independently without seeing others' thinking, then the orchestrator
// synthesizes a verdict.

type SetState = StoreApi<CouncilStoreState>['setState'];
type GetState = StoreApi<CouncilStoreState>['getState'];

async function runParallelDiscussion(
  userQuestion: string,
  models: ModelConfig[],
  masterModel: MasterModelConfig,
  discussionDepth: DiscussionDepth,
  getApiKey: (service: string) => Promise<string | null>,
  onEntryComplete: (entry: DiscussionEntry) => void,
  set: SetState,
  get: GetState,
): Promise<void> {
  const discussionSoFar: DiscussionEntry[] = [
    { role: 'user', content: userQuestion },
  ];

  let masterPromptGenUsage: UsageData | undefined;

  // ── Step 1: Generate system prompts + optional clarifying questions ──
  set({ state: 'generating_system_prompts' });

  try {
    const masterApiKey = await getApiKey(
      `com.council-of-ai-agents.${masterModel.provider}`,
    );
    if (!masterApiKey) {
      set({ state: 'error', error: `No API key found for master model provider (${masterModel.provider})` });
      return;
    }

    const promptGenMessages: ChatMessage[] = [
      {
        role: 'user',
        content: `You are the orchestrator of a council of AI models helping a user make an informed decision. The user's question is:

"${userQuestion}"

The following AI models will ALL respond to this question SIMULTANEOUSLY (in parallel). They will NOT see each other's responses:
${models.map((m, i) => `${i + 1}. ${m.displayName} (${m.provider})`).join('\n')}

Your tasks:
1. If the user's question is ambiguous or missing important context, include up to 2 clarifying questions in the "clarifyingQuestions" array. If the question is clear, leave the array empty.
2. Generate a specific, tailored system prompt for EACH council model. Since models respond independently, each prompt should encourage unique perspectives and independent analysis.
${discussionDepth === 'concise' ? '\nIMPORTANT: Instruct each model to keep responses brief and focused — 2-3 key points maximum.\n' : ''}
Return your response in this exact JSON format:
{
  "clarifyingQuestions": [],
  "prompts": ${JSON.stringify(
    models.reduce(
      (acc, m) => ({
        ...acc,
        [`${m.provider}:${m.model}`]: 'system prompt here',
      }),
      {},
    ),
    null,
    4,
  )}
}`,
      },
    ];

    const streamId = uuidv4();
    const unlisten = await tauri.onStreamToken(streamId, (token) => {
      if (!token.done) {
        set((s) => ({
          currentStreamContent: s.currentStreamContent + token.token,
        }));
      }
    });

    set({ currentStreamId: streamId, currentStreamContent: '' });

    const result = await tauri.streamChat(
      masterModel.provider,
      masterModel.model,
      promptGenMessages,
      'You are an AI orchestrator. Generate system prompts and optional clarifying questions. Return valid JSON only.',
      masterApiKey,
      streamId,
    );

    unlisten();
    set({ currentStreamId: null, currentStreamContent: '' });
    masterPromptGenUsage = result.usage;

    // Parse the combined response
    let clarifyingQuestions: string[] = [];
    const promptMap = new Map<string, string>();

    try {
      const jsonMatch = result.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Extract clarifying questions
        if (Array.isArray(parsed.clarifyingQuestions) && parsed.clarifyingQuestions.length > 0) {
          clarifyingQuestions = parsed.clarifyingQuestions;
        }

        // Extract prompts
        const prompts = parsed.prompts || parsed;
        for (const [key, value] of Object.entries(prompts)) {
          if (key !== 'clarifyingQuestions') {
            promptMap.set(key, value as string);
          }
        }
      }
    } catch {
      console.warn('Failed to parse parallel prompt response, using defaults');
    }

    set({ systemPrompts: promptMap });

    // ── Step 2: Handle clarifying questions (if any) ──
    if (clarifyingQuestions.length > 0) {
      const combinedQuestion = clarifyingQuestions.join('\n\n');

      set({
        state: 'clarifying_qa',
        waitingForClarification: true,
        clarifyingExchanges: [{ question: combinedQuestion, answer: '' }],
      });

      // Wait for user's clarification answer
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          const current = get();
          if (!current.waitingForClarification) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 200);
      });
    }

    // ── Step 3: Pre-resolve all API keys (fail fast) ──
    const uniqueProviders = [...new Set(models.map((m) => m.provider))];
    const apiKeyMap = new Map<string, string>();

    for (const provider of uniqueProviders) {
      const key = await getApiKey(`com.council-of-ai-agents.${provider}`);
      if (!key) {
        set({ state: 'error', error: `No API key found for provider: ${provider}` });
        return;
      }
      apiKeyMap.set(provider, key);
    }

    // ── Step 4: Dispatch all models in parallel ──
    set({
      state: 'parallel_model_turns',
      parallelStreams: {},
      parallelStreamIds: {},
      parallelCompletedCount: 0,
      parallelTotalCount: models.length,
    });

    // Build context that all models share (user question + optional clarification)
    const clarificationContext = get().clarifyingExchanges;
    const baseMessages: ChatMessage[] = [
      { role: 'user', content: userQuestion },
    ];

    if (clarificationContext.length > 0 && clarificationContext[0].answer) {
      baseMessages.push({
        role: 'user',
        content: `Additional context from clarification:\nQ: ${clarificationContext[0].question}\nA: ${clarificationContext[0].answer}`,
      });
    }

    const modelPromises = models.map(async (model, modelIndex) => {
      const apiKey = apiKeyMap.get(model.provider)!;
      const modelStreamId = uuidv4();

      // Register stream
      set((s) => ({
        parallelStreamIds: { ...s.parallelStreamIds, [modelIndex]: modelStreamId },
        parallelStreams: { ...s.parallelStreams, [modelIndex]: '' },
      }));

      const modelUnlisten = await tauri.onStreamToken(modelStreamId, (token) => {
        if (!token.done && !token.error) {
          set((s) => ({
            parallelStreams: {
              ...s.parallelStreams,
              [modelIndex]: (s.parallelStreams[modelIndex] || '') + token.token,
            },
          }));
        }
      });

      try {
        // Get system prompt from master's generated prompts, or fallback
        const systemPromptKey = `${model.provider}:${model.model}`;
        const systemPrompt =
          get().systemPrompts.get(systemPromptKey) || getDefaultParallelPrompt(model, discussionDepth);

        const result = await tauri.streamChat(
          model.provider,
          model.model,
          baseMessages,
          systemPrompt,
          apiKey,
          modelStreamId,
        );

        modelUnlisten();

        // Create entry and emit immediately (progressive emission)
        const entry: DiscussionEntry = {
          role: 'model',
          provider: model.provider,
          model: model.model,
          displayName: model.displayName,
          systemPrompt,
          content: result.content,
          usage: result.usage,
        };
        discussionSoFar.push(entry);
        onEntryComplete(entry);

        // Remove from parallelStreams, increment completed count
        set((s) => {
          const streams = { ...s.parallelStreams };
          delete streams[modelIndex];
          const ids = { ...s.parallelStreamIds };
          delete ids[modelIndex];
          return {
            parallelStreams: streams,
            parallelStreamIds: ids,
            parallelCompletedCount: s.parallelCompletedCount + 1,
          };
        });
      } catch (err) {
        modelUnlisten();

        // Error entry — doesn't abort other models
        const entry: DiscussionEntry = {
          role: 'model',
          provider: model.provider,
          model: model.model,
          displayName: model.displayName,
          content: `[Error: Failed to get response - ${err}]`,
        };
        discussionSoFar.push(entry);
        onEntryComplete(entry);

        set((s) => {
          const streams = { ...s.parallelStreams };
          delete streams[modelIndex];
          const ids = { ...s.parallelStreamIds };
          delete ids[modelIndex];
          return {
            parallelStreams: streams,
            parallelStreamIds: ids,
            parallelCompletedCount: s.parallelCompletedCount + 1,
          };
        });
      }
    });

    // Wait for ALL models to complete (regardless of individual failures)
    await Promise.allSettled(modelPromises);

    // Clear parallel state
    set({
      parallelStreams: {},
      parallelStreamIds: {},
    });

    // ── Step 5: Master verdict (reuses existing logic) ──
    set({ state: 'master_verdict', currentModelIndex: -1 });

    const verdictMessages: ChatMessage[] = [
      {
        role: 'user',
        content: buildMasterVerdictPrompt(userQuestion, discussionSoFar),
      },
    ];

    const verdictStreamId = uuidv4();
    set({ currentStreamId: verdictStreamId, currentStreamContent: '' });

    const verdictUnlisten = await tauri.onStreamToken(verdictStreamId, (token) => {
      if (!token.done && !token.error) {
        set((s) => ({
          currentStreamContent: s.currentStreamContent + token.token,
        }));
      }
    });

    const masterSystemPrompt = discussionDepth === 'concise'
      ? `You are the master AI judge in a council of AI models. Each model responded INDEPENDENTLY to the user's question without seeing each other's responses. Deliver a brief, focused verdict in 3-5 sentences. Highlight key agreements, disagreements, and your recommended action.`
      : `You are the master AI judge in a council of AI models. Each model responded INDEPENDENTLY to the user's question without seeing each other's responses. Your job is to synthesize all independent perspectives, identify genuine consensus vs. coincidental agreement, resolve disagreements, and deliver a clear, actionable final verdict. Structure your response with clear sections.`;

    const verdictResult = await tauri.streamChat(
      masterModel.provider,
      masterModel.model,
      verdictMessages,
      masterSystemPrompt,
      masterApiKey,
      verdictStreamId,
    );

    verdictUnlisten();
    set({ currentStreamId: null, currentStreamContent: '' });

    const masterTotalUsage = combineUsage(masterPromptGenUsage, verdictResult.usage);

    const verdictEntry: DiscussionEntry = {
      role: 'master_verdict',
      provider: masterModel.provider,
      model: masterModel.model,
      content: verdictResult.content,
      usage: masterTotalUsage,
    };
    onEntryComplete(verdictEntry);

    set({ state: 'complete' });
  } catch (err) {
    set({ state: 'error', error: `Parallel discussion failed: ${err}` });
  }
}
