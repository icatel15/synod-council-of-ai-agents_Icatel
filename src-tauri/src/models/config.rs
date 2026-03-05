use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[allow(clippy::upper_case_acronyms)]
pub enum Provider {
    Anthropic,
    OpenAI,
    Google,
    XAI,
    DeepSeek,
    Mistral,
    Together,
    Cohere,
    OpenRouter,
}

#[allow(dead_code)]
impl Provider {
    pub fn display_name(&self) -> &str {
        match self {
            Provider::Anthropic => "Anthropic",
            Provider::OpenAI => "OpenAI",
            Provider::Google => "Google",
            Provider::XAI => "xAI",
            Provider::DeepSeek => "DeepSeek",
            Provider::Mistral => "Mistral",
            Provider::Together => "Together AI",
            Provider::Cohere => "Cohere",
            Provider::OpenRouter => "OpenRouter",
        }
    }

    pub fn keychain_service(&self) -> &str {
        match self {
            Provider::Anthropic => "com.council-of-ai-agents.anthropic",
            Provider::OpenAI => "com.council-of-ai-agents.openai",
            Provider::Google => "com.council-of-ai-agents.google",
            Provider::XAI => "com.council-of-ai-agents.xai",
            Provider::DeepSeek => "com.council-of-ai-agents.deepseek",
            Provider::Mistral => "com.council-of-ai-agents.mistral",
            Provider::Together => "com.council-of-ai-agents.together",
            Provider::Cohere => "com.council-of-ai-agents.cohere",
            Provider::OpenRouter => "com.council-of-ai-agents.openrouter",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
    pub provider: Provider,
    pub model: String,
    pub display_name: String,
    pub order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MasterModelConfig {
    pub provider: Provider,
    pub model: String,
}

pub const DEFAULT_SUMMARIZER_SYSTEM_PROMPT: &str = "You are an expert synthesizer. You have received independent analyses from multiple AI models on the user's question. Your job is to produce a comprehensive, high-quality final output that:\n\n1. Preserves the FULL depth and detail from the best individual responses\n2. Integrates complementary insights across all models\n3. Resolves contradictions with clear reasoning\n4. Maintains specific examples, code snippets, and actionable recommendations\n5. Structures the output clearly with sections and formatting\n\nDo NOT summarize briefly. The user wants the COMPLETE synthesized knowledge, not a summary. Your output should be at least as detailed as the most detailed individual response. Aim for thoroughness over brevity.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarizerModelConfig {
    pub provider: Provider,
    pub model: String,
    pub system_prompt: String,
}

impl Default for SummarizerModelConfig {
    fn default() -> Self {
        Self {
            provider: Provider::Anthropic,
            model: "claude-opus-4-6".to_string(),
            system_prompt: DEFAULT_SUMMARIZER_SYSTEM_PROMPT.to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemPromptMode {
    #[default]
    Upfront,
    Dynamic,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    Light,
    Dark,
    #[default]
    System,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CursorStyle {
    Ripple,
    Breathing,
    #[default]
    Orbit,
    Multi,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiscussionDepth {
    #[default]
    Thorough,
    Concise,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiscussionMode {
    #[default]
    Sequential,
    Parallel,
    Orchestrator,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub council_models: Vec<ModelConfig>,
    pub master_model: MasterModelConfig,
    #[serde(default)]
    pub summarizer_model: SummarizerModelConfig,
    #[serde(default)]
    pub system_prompt_mode: SystemPromptMode,
    #[serde(default)]
    pub discussion_depth: DiscussionDepth,
    #[serde(default)]
    pub discussion_mode: DiscussionMode,
    pub theme: ThemeMode,
    #[serde(default)]
    pub cursor_style: CursorStyle,
    pub session_save_path: Option<String>,
    pub setup_completed: bool,
    #[serde(default)]
    pub council_presets: Vec<serde_json::Value>,
    #[serde(default)]
    pub active_preset_id: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            council_models: vec![],
            master_model: MasterModelConfig {
                provider: Provider::Anthropic,
                model: "claude-opus-4-6".to_string(),
            },
            summarizer_model: SummarizerModelConfig::default(),
            system_prompt_mode: SystemPromptMode::default(),
            discussion_depth: DiscussionDepth::default(),
            discussion_mode: DiscussionMode::default(),
            theme: ThemeMode::default(),
            cursor_style: CursorStyle::default(),
            session_save_path: None,
            setup_completed: false,
            council_presets: vec![],
            active_preset_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct StreamRequest {
    pub provider: Provider,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub system_prompt: Option<String>,
    pub stream_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageData {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamToken {
    pub stream_id: String,
    pub token: String,
    pub done: bool,
    pub error: Option<String>,
    pub usage: Option<UsageData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamChatResult {
    pub content: String,
    pub usage: Option<UsageData>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn app_settings_default_includes_new_discussion_and_preset_fields() {
        let settings = AppSettings::default();
        assert!(matches!(settings.discussion_mode, DiscussionMode::Sequential));
        assert!(settings.council_presets.is_empty());
        assert!(settings.active_preset_id.is_none());
    }

    #[test]
    fn app_settings_deserialization_backfills_defaults_for_new_fields() {
        let payload = json!({
            "councilModels": [],
            "masterModel": { "provider": "anthropic", "model": "claude-opus-4-6" },
            "theme": "system",
            "sessionSavePath": null,
            "setupCompleted": false
        });

        let parsed: AppSettings = serde_json::from_value(payload).expect("settings should deserialize");

        assert!(matches!(parsed.system_prompt_mode, SystemPromptMode::Upfront));
        assert!(matches!(parsed.discussion_depth, DiscussionDepth::Thorough));
        assert!(matches!(parsed.discussion_mode, DiscussionMode::Sequential));
        assert!(parsed.council_presets.is_empty());
        assert!(parsed.active_preset_id.is_none());
    }

    #[test]
    fn provider_keychain_service_mapping_still_matches_expected_ids() {
        assert_eq!(
            Provider::OpenRouter.keychain_service(),
            "com.council-of-ai-agents.openrouter"
        );
        assert_eq!(Provider::XAI.display_name(), "xAI");
    }
}
