pub mod cli_bridge;
pub mod http_transport;
pub mod tool_routes;

use rmcp::{
    handler::server::router::tool::ToolRouter,
    handler::server::wrapper::Parameters,
    model::{Implementation, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, ErrorData, ServerHandler,
};
use serde_json::Value;

pub const SERVER_NAME: &str = "filesystem-mcp";
pub const SERVER_VERSION: &str = "0.7.0";
pub const SERVER_INSTRUCTIONS: &str =
    "Filesystem MCP server (Rust rmcp transport). All tools operate relative to the project root with Rust policy/search/walk engines when enabled.";

#[derive(Clone)]
pub struct FilesystemMcp {
    pub tool_router: ToolRouter<Self>,
}

impl FilesystemMcp {
    pub fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }

    fn invoke(&self, tool: &str, args: Value) -> Result<rmcp::model::CallToolResult, ErrorData> {
        cli_bridge::invoke_cli_tool(tool, args)
    }
}

#[tool_router]
impl FilesystemMcp {
    #[tool(description = "List files/directories. Can optionally include stats and list recursively.")]
    fn list_files(&self, Parameters(args): Parameters<Value>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("list_files", args)
    }

    #[tool(description = "Get detailed status information for multiple specified paths.")]
    fn stat_items(&self, Parameters(args): Parameters<Value>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("stat_items", args)
    }

    #[tool(description = "Read content from multiple specified files.")]
    fn read_content(&self, Parameters(args): Parameters<Value>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("read_content", args)
    }

    #[tool(description = "Write or append content to multiple specified files (creating directories if needed).")]
    fn write_content(&self, Parameters(args): Parameters<Value>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("write_content", args)
    }

    #[tool(description = "Delete multiple specified files or directories.")]
    fn delete_items(&self, Parameters(args): Parameters<Value>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("delete_items", args)
    }

    #[tool(description = "Create multiple specified directories (including intermediate ones).")]
    fn create_directories(
        &self,
        Parameters(args): Parameters<Value>,
    ) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("create_directories", args)
    }

    #[tool(description = "Change permissions mode for multiple specified files/directories (POSIX-style).")]
    fn chmod_items(&self, Parameters(args): Parameters<Value>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("chmod_items", args)
    }

    #[tool(description = "Change owner (UID) and group (GID) for multiple specified files/directories.")]
    fn chown_items(&self, Parameters(args): Parameters<Value>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("chown_items", args)
    }

    #[tool(description = "Move or rename multiple specified files/directories.")]
    fn move_items(&self, Parameters(args): Parameters<Value>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("move_items", args)
    }

    #[tool(description = "Copy multiple specified files/directories.")]
    fn copy_items(&self, Parameters(args): Parameters<Value>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("copy_items", args)
    }

    #[tool(description = "Search for a regex pattern within files in a specified directory (read-only).")]
    fn search_files(&self, Parameters(args): Parameters<Value>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("search_files", args)
    }

    #[tool(description = "Replace content within files across multiple specified paths.")]
    fn replace_content(
        &self,
        Parameters(args): Parameters<Value>,
    ) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("replace_content", args)
    }

    #[tool(description = "Apply diffs to files")]
    fn apply_diff(&self, Parameters(args): Parameters<Value>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("apply_diff", args)
    }
}

#[tool_handler]
impl ServerHandler for FilesystemMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: rmcp::model::ProtocolVersion::default(),
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: SERVER_NAME.into(),
                title: None,
                version: SERVER_VERSION.into(),
                description: Some("Rust-native MCP transport for filesystem-mcp".into()),
                icons: None,
                website_url: Some("https://github.com/SylphxAI/filesystem-mcp".into()),
            },
            instructions: Some(SERVER_INSTRUCTIONS.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::FilesystemMcp;

    #[test]
    fn exposes_filesystem_tool_surface() {
        let tools = FilesystemMcp::new().tool_router.list_all();
        assert!(tools.len() >= 12);
        let names: Vec<_> = tools.iter().map(|tool| tool.name.to_string()).collect();
        assert!(names.contains(&"list_files".to_string()));
        assert!(names.contains(&"search_files".to_string()));
        assert!(names.contains(&"apply_diff".to_string()));
    }
}