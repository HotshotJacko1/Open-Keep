const fs = require('fs');

const path = 'src/hooks/use-one-drive.ts';
let c = fs.readFileSync(path, 'utf8');

c = c.replace(
    'const doInternalSync = async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string): Promise<SyncResult> => {',
    'const doInternalSync = async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> => {'
);

c = c.replace(
    'showSuccess("Notes synced with OneDrive!");',
    'if (!silent) {\n                showSuccess("Notes synced with OneDrive!");\n            }'
);

c = c.replace(
    'const sync = useCallback(async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string) => {',
    'const sync = useCallback(async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false) => {'
);

c = c.replace(
    'return await doInternalSync(forceResolution, cloudPayload, providedPin);',
    'return await doInternalSync(forceResolution, cloudPayload, providedPin, silent);'
);

fs.writeFileSync(path, c, 'utf8');

const path2 = 'src/hooks/use-dropbox.ts';
let c2 = fs.readFileSync(path2, 'utf8');

c2 = c2.replace(
    'const doInternalSync = async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string): Promise<SyncResult> => {',
    'const doInternalSync = async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false): Promise<SyncResult> => {'
);

c2 = c2.replace(
    'showSuccess("Notes synced with Dropbox!");',
    'if (!silent) {\n                showSuccess("Notes synced with Dropbox!");\n            }'
);

c2 = c2.replace(
    'const sync = useCallback(async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string) => {',
    'const sync = useCallback(async (forceResolution?: "local" | "cloud" | "merge", cloudPayload?: string, providedPin?: string, silent: boolean = false) => {'
);

c2 = c2.replace(
    'return await doInternalSync(forceResolution, cloudPayload, providedPin);',
    'return await doInternalSync(forceResolution, cloudPayload, providedPin, silent);'
);

fs.writeFileSync(path2, c2, 'utf8');

console.log('done');
