use filesystem_mcp_server::{cli_bridge, FilesystemMcp, SERVER_VERSION};
use rmcp::ServiceExt;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("doctor") {
        eprintln!(
            "filesystem-mcp Rust MCP server {SERVER_VERSION} ({})",
            filesystem_core::ENGINE_NAME
        );
        if let Some(cli) = cli_bridge::resolve_cli_binary() {
            eprintln!("engine cli: {}", cli.display());
        } else {
            eprintln!("engine cli: unavailable (run `bun run build:rust`)");
        }
        return Ok(());
    }

    let service = FilesystemMcp::new().serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}