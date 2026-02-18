import { readFile, readdir, access } from 'fs/promises';
import { join, extname, basename } from 'path';
import type { ProjectContext } from '../types.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

async function readPackageJson(projectDir: string): Promise<PackageJson | null> {
  try {
    const content = await readFile(join(projectDir, 'package.json'), 'utf-8');
    return JSON.parse(content) as PackageJson;
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getAllDeps(pkg: PackageJson): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

function hasDep(pkg: PackageJson, name: string): boolean {
  const deps = getAllDeps(pkg);
  return name in deps;
}

function getDepVersion(pkg: PackageJson, name: string): string | null {
  const deps = getAllDeps(pkg);
  return deps[name]?.replace(/^[\^~>=<]/, '') ?? null;
}

function hasDepPrefix(pkg: PackageJson, prefix: string): boolean {
  const deps = getAllDeps(pkg);
  return Object.keys(deps).some((k) => k.startsWith(prefix));
}

function detectFramework(pkg: PackageJson): {
  framework: ProjectContext['framework'];
  metaFramework: ProjectContext['metaFramework'];
  version: string | null;
} {
  let framework: ProjectContext['framework'] = null;
  let metaFramework: ProjectContext['metaFramework'] = null;
  let version: string | null = null;

  if (hasDep(pkg, 'react') || hasDep(pkg, 'react-dom')) {
    framework = 'react';
    version = getDepVersion(pkg, 'react');
  } else if (hasDep(pkg, 'vue')) {
    framework = 'vue';
    version = getDepVersion(pkg, 'vue');
  } else if (hasDep(pkg, 'svelte')) {
    framework = 'svelte';
    version = getDepVersion(pkg, 'svelte');
  }

  if (hasDep(pkg, 'next')) {
    metaFramework = 'next';
    version = getDepVersion(pkg, 'next');
    framework = framework ?? 'react';
  } else if (hasDep(pkg, 'nuxt')) {
    metaFramework = 'nuxt';
    version = getDepVersion(pkg, 'nuxt');
    framework = framework ?? 'vue';
  } else if (hasDep(pkg, '@remix-run/react')) {
    metaFramework = 'remix';
    framework = framework ?? 'react';
  } else if (hasDep(pkg, '@sveltejs/kit')) {
    metaFramework = 'sveltekit';
    framework = framework ?? 'svelte';
  }

  return { framework, metaFramework, version };
}

async function detectCSS(
  pkg: PackageJson,
  projectDir: string,
): Promise<ProjectContext['css']> {
  if (hasDep(pkg, 'tailwindcss')) {
    let config: string | null = null;
    for (const name of ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs', 'tailwind.config.cjs']) {
      if (await exists(join(projectDir, name))) {
        config = name;
        break;
      }
    }
    return { method: 'tailwind', version: getDepVersion(pkg, 'tailwindcss'), config };
  }

  if (hasDep(pkg, 'styled-components')) {
    return { method: 'styled-components', version: getDepVersion(pkg, 'styled-components'), config: null };
  }

  const srcDir = join(projectDir, 'src');
  try {
    const files = await readdir(srcDir, { recursive: true });
    const hasModules = files.some((f) => typeof f === 'string' && f.endsWith('.module.css'));
    if (hasModules) {
      return { method: 'modules', version: null, config: null };
    }
  } catch {
    // src dir may not exist
  }

  return { method: 'css', version: null, config: null };
}

async function detectLanguage(projectDir: string): Promise<ProjectContext['language']> {
  return (await exists(join(projectDir, 'tsconfig.json'))) ? 'typescript' : 'javascript';
}

function detectDevServer(pkg: PackageJson): ProjectContext['devServer'] {
  const scripts = pkg.scripts ?? {};
  let command = 'npm run dev';
  let port = 3000;

  if (scripts.dev) {
    command = 'npm run dev';
    const portMatch = scripts.dev.match(/(?:--port|-p)\s+(\d+)/);
    if (portMatch) {
      port = parseInt(portMatch[1], 10);
    }
  } else if (scripts.start) {
    command = 'npm start';
    const portMatch = scripts.start.match(/(?:--port|-p)\s+(\d+)/);
    if (portMatch) {
      port = parseInt(portMatch[1], 10);
    }
  }

  return { command, port };
}

async function detectComponentPatterns(
  projectDir: string,
): Promise<{ pattern: ProjectContext['componentPattern']; naming: string; extension: string }> {
  const srcDir = join(projectDir, 'src');
  let pattern: ProjectContext['componentPattern'] = null;
  let naming = 'PascalCase';
  let extension = '.tsx';

  try {
    const allFiles = await readdir(srcDir, { recursive: true });
    const componentFiles = (allFiles as string[]).filter(
      (f) => /\.(tsx|jsx|vue|svelte)$/.test(f),
    ).slice(0, 5);

    if (componentFiles.length === 0) {
      return { pattern, naming, extension };
    }

    extension = extname(componentFiles[0]);

    for (const file of componentFiles.slice(0, 3)) {
      try {
        const content = await readFile(join(srcDir, file), 'utf-8');
        if (content.includes('class ') && content.includes('extends')) {
          pattern = 'class';
        } else if (content.includes('function ') || content.includes('=>')) {
          pattern = 'functional';
        }
        if (pattern) break;
      } catch {
        continue;
      }
    }

    const firstFileName = basename(componentFiles[0], extname(componentFiles[0]));
    if (/^[A-Z][a-zA-Z]+$/.test(firstFileName)) {
      naming = 'PascalCase';
    } else if (/^[a-z]+-[a-z]+/.test(firstFileName)) {
      naming = 'kebab-case';
    } else if (/^[a-z][a-zA-Z]+$/.test(firstFileName)) {
      naming = 'camelCase';
    }
  } catch {
    // src dir may not exist
  }

  return { pattern, naming, extension };
}

function detectDesignSystem(pkg: PackageJson): string | null {
  if (hasDepPrefix(pkg, '@radix-ui/')) return 'shadcn/ui';
  if (hasDep(pkg, '@mui/material')) return 'mui';
  if (hasDep(pkg, 'antd')) return 'ant-design';
  if (hasDep(pkg, '@chakra-ui/react')) return 'chakra';
  return null;
}

function detectStateManagement(pkg: PackageJson): string | null {
  if (hasDep(pkg, 'zustand')) return 'zustand';
  if (hasDep(pkg, '@reduxjs/toolkit') || hasDep(pkg, 'redux')) return 'redux';
  if (hasDep(pkg, 'jotai')) return 'jotai';
  if (hasDep(pkg, 'recoil')) return 'recoil';
  if (hasDep(pkg, 'pinia')) return 'pinia';
  if (hasDep(pkg, 'vuex')) return 'vuex';
  return null;
}

function detectStyleExtension(cssMethod: string | null, lang: string): string | null {
  if (cssMethod === 'modules') return lang === 'typescript' ? '.module.css' : '.module.css';
  if (cssMethod === 'css') return '.css';
  if (cssMethod === 'tailwind') return null;
  if (cssMethod === 'styled-components') return null;
  return null;
}

export async function detectProjectContext(projectDir: string): Promise<ProjectContext> {
  const pkg = await readPackageJson(projectDir);

  if (!pkg) {
    return {
      framework: null,
      metaFramework: null,
      version: null,
      language: await detectLanguage(projectDir),
      css: { method: null, version: null, config: null },
      componentPattern: null,
      fileConvention: { naming: 'PascalCase', extension: '.html', styleExtension: '.css' },
      designSystem: null,
      stateManagement: null,
      devServer: { command: 'npm run dev', port: 3000 },
    };
  }

  const { framework, metaFramework, version } = detectFramework(pkg);
  const css = await detectCSS(pkg, projectDir);
  const language = await detectLanguage(projectDir);
  const { pattern, naming, extension } = await detectComponentPatterns(projectDir);
  const designSystem = detectDesignSystem(pkg);
  const stateManagement = detectStateManagement(pkg);
  const devServer = detectDevServer(pkg);
  const styleExtension = detectStyleExtension(css.method, language);

  return {
    framework,
    metaFramework,
    version,
    language,
    css,
    componentPattern: pattern,
    fileConvention: { naming, extension, styleExtension },
    designSystem,
    stateManagement,
    devServer,
  };
}
