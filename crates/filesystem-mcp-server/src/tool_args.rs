use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

/// JSON object arguments for filesystem MCP tools (validated in cli_bridge).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FilesystemToolArgs {
    #[serde(flatten)]
    pub args: HashMap<String, Value>,
}

impl FilesystemToolArgs {
    pub fn into_value(self) -> Value {
        Value::Object(self.args.into_iter().collect::<Map<String, Value>>())
    }
}

#[cfg(test)]
mod tests {
    use super::FilesystemToolArgs;
    use schemars::schema_for;

    #[test]
    fn filesystem_tool_args_schema_is_object_root() {
        let schema = schema_for!(FilesystemToolArgs);
        let json = serde_json::to_value(schema).expect("schema json");
        assert_eq!(json.get("type").and_then(|v| v.as_str()), Some("object"));
    }
}