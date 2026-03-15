const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const inputDir = path.resolve(__dirname, '../dist');

const obfuscateFiles = (dir) => {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      obfuscateFiles(fullPath);
    } else if (file.endsWith('.js')) {
      const code = fs.readFileSync(fullPath, 'utf8');
      const obfuscated = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,
        deadCodeInjection: true,
        stringArray: true,
        stringArrayEncoding: ['base64'],
        rotateStringArray: true,
      });
      fs.writeFileSync(fullPath, obfuscated.getObfuscatedCode());
    }
  }
};

obfuscateFiles(inputDir);