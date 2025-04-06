import { defineConfig } from 'vitepress';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  lang: 'en-US',
  title: 'Filesystem MCP Server',
  description: 'Secure & Efficient Filesystem Access for AI Agents via MCP',
  lastUpdated: true,
  cleanUrls: true,

  // Theme related configurations.
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: '/logo.svg', // Optional: Add logo later if available
    siteTitle: 'Filesystem MCP',

    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'API Reference', link: '/api/' }, // Link to future API docs
      {
        text: 'Changelog',
        link: 'https://github.com/sylphlab/filesystem-mcp/blob/main/CHANGELOG.md',
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            // Add more guide pages later (e.g., installation, usage)
          ],
        },
      ],
      '/api/': [
        // API docs sidebar (potentially auto-generated later)
        { text: 'API Home', link: '/api/' },
        // Add links to modules/classes later
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/sylphlab/filesystem-mcp' },
    ],

    editLink: {
      pattern:
        'https://github.com/sylphlab/filesystem-mcp/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: `Copyright © ${new Date().getFullYear()} Sylph Lab`,
    },

    // Optional: Algolia DocSearch
    // search: {
    //   provider: 'algolia',
    //   options: {
    //     appId: '...',
    //     apiKey: '...',
    //     indexName: '...'
    //   }
    // }
  },

  // Optional: Markdown configuration
  markdown: {
    lineNumbers: true,
  },

  // Optional: Add head elements, like favicons
  head: [
    // ['link', { rel: 'icon', href: '/favicon.ico' }]
  ],
});
