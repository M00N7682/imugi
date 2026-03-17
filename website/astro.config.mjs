// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://imugi.ddstudio.co.kr',
	integrations: [
		starlight({
			title: 'imugi',
			description: 'Design to Code — AI-powered frontend builder with visual verification',
			logo: {
				src: './src/assets/logo.png',
				alt: 'imugi',
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/M00N7682/imugi' },
			],
			customCss: ['./src/styles/custom.css'],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Installation', slug: 'getting-started/installation' },
						{ label: 'Quick Start', slug: 'getting-started/quickstart' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'MCP Server Setup', slug: 'guides/mcp-server' },
						{ label: 'Figma Integration', slug: 'guides/figma' },
						{ label: 'CI / GitHub Action', slug: 'guides/ci' },
						{ label: 'Configuration', slug: 'guides/configuration' },
						{ label: 'imugi vs Alternatives', slug: 'guides/alternatives' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'CLI Commands', slug: 'reference/cli' },
						{ label: 'MCP Tools', slug: 'reference/mcp-tools' },
						{ label: 'Comparison Algorithm', slug: 'reference/algorithm' },
						{ label: 'Architecture', slug: 'reference/architecture' },
					],
				},
			],
			head: [
				{
					tag: 'meta',
					attrs: {
						property: 'og:image',
						content: 'https://raw.githubusercontent.com/M00N7682/imugi/main/assets/demo-visual.png',
					},
				},
			],
		}),
	],
});
