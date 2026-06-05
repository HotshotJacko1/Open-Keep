import { DropboxAuth } from 'dropbox';

async function test() {
    try {
        const dbxAuth = new DropboxAuth({ clientId: 'test' });
        const p = await dbxAuth.getAuthenticationUrl('openkeep://auth', undefined, 'code', 'offline', undefined, undefined, true);
        console.log("SUCCESS:", p);
    } catch (e) {
        console.error("ERROR:", e);
    }
}
test();
