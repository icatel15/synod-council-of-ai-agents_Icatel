use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures::StreamExt;
use tauri::{command, AppHandle, Emitter, State};

use crate::models::config::{ChatMessage, Provider, StreamChatResult, StreamToken, UsageData};
use crate::providers::{
    anthropic::AnthropicProvider, cohere::CohereProvider, deepseek::DeepSeekProvider,
    google::GoogleProvider, mistral::MistralProvider, openai::OpenAIProvider,
    openrouter::OpenRouterProvider, together::TogetherProvider, xai::XAIProvider, StreamEvent,
};

#[derive(Default)]
pub struct ActiveStreams {
    pub streams: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[command]
pub async fn stream_chat(
    app: AppHandle,
    active_streams: State<'_, ActiveStreams>,
    provider: Provider,
    model: String,
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
    api_key: String,
    stream_id: String,
) -> Result<StreamChatResult, String> {
    // Register this stream's cancel flag
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut streams = active_streams.streams.lock().unwrap();
        streams.insert(stream_id.clone(), cancel_flag.clone());
    }
    let system_ref = system_prompt.as_deref();
    let event_name = format!("stream-token-{}", stream_id);

    let result = match provider {
        Provider::Anthropic => {
            let p = AnthropicProvider::new();
            p.stream_chat(&api_key, &model, &messages, system_ref).await
        }
        Provider::OpenAI => {
            let p = OpenAIProvider::new();
            p.stream_chat(&api_key, &model, &messages, system_ref).await
        }
        Provider::Google => {
            let p = GoogleProvider::new();
            p.stream_chat(&api_key, &model, &messages, system_ref).await
        }
        Provider::XAI => {
            let p = XAIProvider::new();
            p.stream_chat(&api_key, &model, &messages, system_ref).await
        }
        Provider::DeepSeek => {
            let p = DeepSeekProvider::new();
            p.stream_chat(&api_key, &model, &messages, system_ref).await
        }
        Provider::Mistral => {
            let p = MistralProvider::new();
            p.stream_chat(&api_key, &model, &messages, system_ref).await
        }
        Provider::Together => {
            let p = TogetherProvider::new();
            p.stream_chat(&api_key, &model, &messages, system_ref).await
        }
        Provider::Cohere => {
            let p = CohereProvider::new();
            p.stream_chat(&api_key, &model, &messages, system_ref).await
        }
        Provider::OpenRouter => {
            let p = OpenRouterProvider::new();
            p.stream_chat(&api_key, &model, &messages, system_ref).await
        }
    };

    match result {
        Ok(mut stream) => {
            let mut full_response = String::new();
            let mut accumulated_usage = UsageData {
                input_tokens: 0,
                output_tokens: 0,
            };

            while let Some(event_result) = stream.next().await {
                // Check cancel flag before processing each chunk
                if cancel_flag.load(Ordering::Relaxed) {
                    let _ = app.emit(
                        &event_name,
                        StreamToken {
                            stream_id: stream_id.clone(),
                            token: String::new(),
                            done: true,
                            error: Some("aborted".to_string()),
                            usage: None,
                        },
                    );
                    // Cleanup
                    let mut streams = active_streams.streams.lock().unwrap();
                    streams.remove(&stream_id);
                    return Err("aborted".to_string());
                }

                match event_result {
                    Ok(StreamEvent::Token(token)) => {
                        full_response.push_str(&token);
                        let _ = app.emit(
                            &event_name,
                            StreamToken {
                                stream_id: stream_id.clone(),
                                token,
                                done: false,
                                error: None,
                                usage: None,
                            },
                        );
                    }
                    Ok(StreamEvent::Usage(usage)) => {
                        // Use MAX rather than SUM: Anthropic sends input/output in separate events
                        // (input=25,output=0 then input=0,output=150 → max gives 25,150 ✓)
                        // Google sends cumulative totals in every chunk
                        // (input=10,output=5 then input=10,output=50 → max gives 10,50 ✓)
                        // OpenAI/others send a single event → max works the same as sum
                        eprintln!("[USAGE] {:?} received: input={}, output={}", provider, usage.input_tokens, usage.output_tokens);
                        accumulated_usage.input_tokens = accumulated_usage.input_tokens.max(usage.input_tokens);
                        accumulated_usage.output_tokens = accumulated_usage.output_tokens.max(usage.output_tokens);
                    }
                    Err(e) => {
                        // Cleanup on error
                        let mut streams = active_streams.streams.lock().unwrap();
                        streams.remove(&stream_id);

                        let _ = app.emit(
                            &event_name,
                            StreamToken {
                                stream_id: stream_id.clone(),
                                token: String::new(),
                                done: true,
                                error: Some(e.to_string()),
                                usage: None,
                            },
                        );
                        return Err(e.to_string());
                    }
                }
            }

            // Cleanup after normal completion
            {
                let mut streams = active_streams.streams.lock().unwrap();
                streams.remove(&stream_id);
            }

            // Emit final done event
            let _ = app.emit(
                &event_name,
                StreamToken {
                    stream_id: stream_id.clone(),
                    token: String::new(),
                    done: true,
                    error: None,
                    usage: None,
                },
            );

            let final_usage = if accumulated_usage.input_tokens > 0 || accumulated_usage.output_tokens > 0 {
                Some(accumulated_usage)
            } else {
                None
            };

            // Return usage via invoke response (reliable, no race condition with events)
            Ok(StreamChatResult {
                content: full_response,
                usage: final_usage,
            })
        }
        Err(e) => {
            // Cleanup on provider error
            {
                let mut streams = active_streams.streams.lock().unwrap();
                streams.remove(&stream_id);
            }

            let _ = app.emit(
                &event_name,
                StreamToken {
                    stream_id: stream_id.clone(),
                    token: String::new(),
                    done: true,
                    error: Some(e.to_string()),
                    usage: None,
                },
            );
            Err(e.to_string())
        }
    }
}

#[command]
pub async fn abort_stream(
    active_streams: State<'_, ActiveStreams>,
    stream_id: String,
) -> Result<(), String> {
    let streams = active_streams.streams.lock().unwrap();
    if let Some(flag) = streams.get(&stream_id) {
        flag.store(true, Ordering::Relaxed);
    }
    // Return Ok even if stream already finished (benign race)
    Ok(())
}
