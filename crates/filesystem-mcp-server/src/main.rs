use filesystem_mcp_server::{engine_bridge, FilesystemMcp, SERVER_VERSION};
use rmcp::ServiceExt;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("doctor") {
        eprintln!("filesystem-mcp Rust MCP server {SERVER_VERSION}");
        if let Some(script) = engine_bridge::resolve_engine_script() {
            eprintln!("engine bridge: {}", script.display());
        } else {
            eprintln!("engine bridge: unavailable (run `bun run build`)");
        }
        return Ok(());
    }

    let service = FilesystemMcp::new().serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}