const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function run(cmd) {
    console.log(`> ${cmd}`);
    execSync(cmd, { stdio: "inherit" });
}

const pkgPath = path.resolve(__dirname, "../package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

// 保存原始版本号，用于回滚
const originalVersion = pkg.version;

function rollback() {
    console.log("⚠️  发布失败，正在回滚...");
    try {
        const currentPkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        currentPkg.version = originalVersion;
        delete currentPkg.type;
        fs.writeFileSync(pkgPath, JSON.stringify(currentPkg, null, 2) + "\n", "utf-8");
        console.log(`✓ 已回滚版本号至: ${originalVersion}`);
        console.log("✓ 已删除 package.json 中的 type 属性");
    } catch (e) {
        console.error("回滚失败:", e.message);
    }
}

try {
    // 1. 清理 dist
    if (fs.existsSync("dist")) {
        fs.rmSync("dist", { recursive: true, force: true });
        console.log("✓ 已删除 dist 目录");
    }

    // 2. 版本号 +0.0.1
    const versionParts = pkg.version.split(".").map(Number);
    versionParts[2] += 1;
    pkg.version = versionParts.join(".");
    console.log(`✓ 新版本号: ${pkg.version}`);

    // 3. 设置 type 属性
    pkg.type = "module";

    // 4. 写回 package.json
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    console.log("✓ package.json 已更新");

    // 5. 构建
    run("npm run build");

    // 6. 发布
    run("npm publish");

    // 7. 发布完成，删除 type 属性
    delete pkg.type;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    console.log("✓ 已删除 package.json 中的 type 属性");

    // 8. cnpm sync
    run(`cnpm sync ${pkg.name}`);

    console.log("✓ 发布完成！");
} catch (e) {
    rollback();
    process.exit(1);
}
