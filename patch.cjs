const fs = require('fs');
const path = 'src/hooks/use-dropbox.ts';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(
    /catch \(error\) \{\s+console\.error\("Dropbox Login init failed:", error\);\s+showError\("Failed to start Dropbox login\."\);\s+\}/,
    'catch (error: any) {\n            console.error("Dropbox Login init failed:", error);\n            showError(`Failed to start Dropbox login: ${error?.message || error}`);\n        }'
);
fs.writeFileSync(path, content);
console.log('done');
