use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::config::{MasterModelConfig, ModelConfig, SummarizerModelConfig, SystemPromptMode, UsageData};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarifyingExchange {
    pub question: String,
    pub answer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all_fields = "camelCase")]
#[serde(tag = "role")]
pub enum DiscussionEntry {
    #[serde(rename = "user")]
    User { content: String },
    #[serde(rename = "model")]
    Model {
        provider: String,
        model: String,
        display_name: String,
        #[serde(default)]
        system_prompt: Option<String>,
        content: String,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        clarifying_exchange: Option<Vec<ClarifyingExchange>>,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<UsageData>,
    },
    #[serde(rename = "master_verdict")]
    MasterVerdict {
        provider: String,
        model: String,
        content: String,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<UsageData>,
    },
    #[serde(rename = "follow_up_question")]
    FollowUpQuestion {
        content: String,
        target_provider: String,
        target_model: String,
        target_display_name: String,
    },
    #[serde(rename = "follow_up_answer")]
    FollowUpAnswer {
        provider: String,
        model: String,
        display_name: String,
        content: String,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<UsageData>,
    },
    #[serde(rename = "orchestrator_message")]
    OrchestratorMessage {
        provider: String,
        model: String,
        content: String,
        #[serde(default)]
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<UsageData>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CouncilConfig {
    pub models: Vec<ModelConfig>,
    pub master_model: MasterModelConfig,
    #[serde(default)]
    pub summarizer_model: Option<SummarizerModelConfig>,
    #[serde(default)]
    pub system_prompt_mode: SystemPromptMode,
    #[serde(default)]
    pub discussion_mode: Option<String>,
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub preset_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub user_question: String,
    pub council_config: CouncilConfig,
    pub discussion: Vec<DiscussionEntry>,
}

#[allow(dead_code)]
impl Session {
    pub fn new(
        user_question: String,
        council_config: CouncilConfig,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            title: truncate_title(&user_question),
            created_at: now,
            updated_at: now,
            user_question,
            council_config,
            discussion: vec![],
        }
    }
}

#[allow(dead_code)]
fn truncate_title(question: &str) -> String {
    let trimmed = question.trim();
    if trimmed.len() <= 60 {
        trimmed.to_string()
    } else {
        format!("{}...", &trimmed[..57])
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn orchestrator_message_roundtrip_preserves_role_and_content() {
        let entry = DiscussionEntry::OrchestratorMessage {
            provider: "anthropic".to_string(),
            model: "claude-opus-4-6".to_string(),
            content: "orchestrator response".to_string(),
            usage: Some(UsageData {
                input_tokens: 11,
                output_tokens: 22,
            }),
        };

        let value = serde_json::to_value(&entry).expect("entry should serialize");
        assert_eq!(value["role"], "orchestrator_message");

        let parsed: DiscussionEntry =
            serde_json::from_value(value).expect("entry should deserialize");

        match parsed {
            DiscussionEntry::OrchestratorMessage {
                provider,
                model,
                content,
                usage,
            } => {
                assert_eq!(provider, "anthropic");
                assert_eq!(model, "claude-opus-4-6");
                assert_eq!(content, "orchestrator response");
                let usage = usage.expect("usage should exist");
                assert_eq!(usage.input_tokens, 11);
                assert_eq!(usage.output_tokens, 22);
            }
            _ => panic!("unexpected discussion entry variant"),
        }
    }

    #[test]
    fn council_config_deserialization_defaults_new_optional_fields() {
        let payload = json!({
            "models": [],
            "masterModel": { "provider": "anthropic", "model": "claude-opus-4-6" }
        });

        let config: CouncilConfig =
            serde_json::from_value(payload).expect("council config should deserialize");

        assert!(matches!(config.system_prompt_mode, SystemPromptMode::Upfront));
        assert!(config.discussion_mode.is_none());
        assert!(config.preset_id.is_none());
        assert!(config.preset_name.is_none());
    }
}
