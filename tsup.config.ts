import { defineConfig } from 'tsup';
export default defineConfig({
    entry: ['src/index.ts'], // 你的主入口
    format: ['esm', 'cjs'],  // 输出两种模块系统
    dts: true,               // 生成类型声明文件
    outDir: 'dist',          // 输出目录
    clean: true,             // 构建前清除 dist
    splitting: false,        // 多入口支持（可以先关掉）
    minify: false,           // 如果要混淆可设 true
    target: 'es2020'
  });
  
  