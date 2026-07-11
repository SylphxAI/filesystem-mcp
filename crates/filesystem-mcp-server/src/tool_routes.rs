//! Explicit shipped routing table for filesystem-mcp primary tools.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolRoute {
    RustCore,
    LegacyOptIn,
}

pub fn route_for_tool(tool: &str) -> Option<ToolRoute> {
    match tool {
        "list_files"
        | "search_files"
        | "resolve_path"
        | "content_hash"
        | "record_write_audit"
        | "read_content"
        | "write_content"
        | "stat_items"
        | "delete_items" => Some(ToolRoute::RustCore),
        "create_directories"
        | "chmod_items"
        | "chown_items"
        | "move_items"
        | "copy_items"
        | "replace_content"
        | "apply_diff" => Some(ToolRoute::LegacyOptIn),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_rust_core_tools_explicitly() {
        assert_eq!(route_for_tool("list_files"), Some(ToolRoute::RustCore));
        assert_eq!(route_for_tool("search_files"), Some(ToolRoute::RustCore));
        assert_eq!(route_for_tool("read_content"), Some(ToolRoute::RustCore));
        assert_eq!(route_for_tool("write_content"), Some(ToolRoute::RustCore));
        assert_eq!(route_for_tool("stat_items"), Some(ToolRoute::RustCore));
        assert_eq!(route_for_tool("delete_items"), Some(ToolRoute::RustCore));
    }
}