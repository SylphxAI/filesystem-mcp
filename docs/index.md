---
layout: home

hero:
  name: Filesystem MCP Server
  text: Secure & Efficient Filesystem Access for AI Agents
  tagline: Empower your AI agents (like Cline/Claude) with secure, efficient, and token-saving access to your project files via the Model Context Protocol.
  image:
    # Replace with a relevant logo/image if available
    # src: /logo.svg
    # alt: Filesystem MCP Server Logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/introduction
    - theme: alt
      text: View on GitHub
      link: https://github.com/sylphlab/filesystem-mcp

features:
  - title: 🛡️ Secure by Design
    details: All operations are strictly confined to the project root directory, preventing unauthorized access. Uses relative paths.
  - title: ⚡ Optimized for AI
    details: Batch operations minimize AI-server round trips, reducing token usage and latency compared to individual commands.
  - title: 🔧 Comprehensive Toolkit
    details: Offers a wide range of tools covering file/directory listing, reading, writing, editing, searching, moving, copying, and more.
  - title: ✅ Robust & Reliable
    details: Uses Zod for argument validation and provides detailed results for batch operations, indicating success or failure for each item.
  - title: 🚀 Easy Integration
    details: Get started quickly using npx or Docker with minimal configuration in your MCP host environment.
  - title: 🤝 Open Source
    details: MIT Licensed and open to contributions.
---
