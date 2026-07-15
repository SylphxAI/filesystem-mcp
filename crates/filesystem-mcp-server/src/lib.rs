pub mod cli_bridge;
pub mod http_transport;
pub mod tool_args;
pub mod tool_routes;

use rmcp::{
    handler::server::router::tool::ToolRouter,
    handler::server::wrapper::Parameters,
    model::{Implementation, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, ErrorData, ServerHandler,
};
use serde_json::Value;

use crate::tool_args::FilesystemToolArgs;

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
    fn list_files(&self, Parameters(args): Parameters<FilesystemToolArgs>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("list_files", args.into_value())
    }

    #[tool(description = "Get detailed status information for multiple specified paths.")]
    fn stat_items(&self, Parameters(args): Parameters<FilesystemToolArgs>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("stat_items", args.into_value())
    }

    #[tool(description = "Read content from multiple specified files.")]
    fn read_content(&self, Parameters(args): Parameters<FilesystemToolArgs>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("read_content", args.into_value())
    }

    #[tool(description = "Write or append content to multiple specified files (creating directories if needed).")]
    fn write_content(&self, Parameters(args): Parameters<FilesystemToolArgs>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("write_content", args.into_value())
    }

    #[tool(description = "Delete multiple specified files or directories.")]
    fn delete_items(&self, Parameters(args): Parameters<FilesystemToolArgs>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("delete_items", args.into_value())
    }

    #[tool(description = "Create multiple specified directories (including intermediate ones).")]
    fn create_directories(
        &self,
        Parameters(args): Parameters<FilesystemToolArgs>,
    ) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("create_directories", args.into_value())
    }

    #[tool(description = "Change permissions mode for multiple specified files/directories (POSIX-style).")]
    fn chmod_items(&self, Parameters(args): Parameters<FilesystemToolArgs>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("chmod_items", args.into_value())
    }

    #[tool(description = "Change owner (UID) and group (GID) for multiple specified files/directories.")]
    fn chown_items(&self, Parameters(args): Parameters<FilesystemToolArgs>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("chown_items", args.into_value())
    }

    #[tool(description = "Move or rename multiple specified files/directories.")]
    fn move_items(&self, Parameters(args): Parameters<FilesystemToolArgs>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("move_items", args.into_value())
    }

    #[tool(description = "Copy multiple specified files/directories.")]
    fn copy_items(&self, Parameters(args): Parameters<FilesystemToolArgs>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("copy_items", args.into_value())
    }

    #[tool(description = "Search for a regex pattern within files in a specified directory (read-only).")]
    fn search_files(&self, Parameters(args): Parameters<FilesystemToolArgs>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("search_files", args.into_value())
    }

    #[tool(description = "Replace content within files across multiple specified paths.")]
    fn replace_content(
        &self,
        Parameters(args): Parameters<FilesystemToolArgs>,
    ) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("replace_content", args.into_value())
    }

    #[tool(description = "Apply diffs to files")]
    fn apply_diff(&self, Parameters(args): Parameters<FilesystemToolArgs>) -> Result<rmcp::model::CallToolResult, ErrorData> {
        self.invoke("apply_diff", args.into_value())
    }
}

#[tool_handler]
impl ServerHandler for FilesystemMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions(SERVER_INSTRUCTIONS)
            .with_server_info(
                Implementation::new(SERVER_NAME, SERVER_VERSION)
                    .with_description("Rust-native MCP transport for filesystem-mcp")
                    .with_website_url("https://github.com/SylphxAI/filesystem-mcp"),
            )
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