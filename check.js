// Verify DISCORD_TOKEN and print the invite URL (client ID read from the API, not guessed).
const t = process.env.DISCORD_TOKEN;
if (!t || t.startsWith('paste-')) { console.error('DISCORD_TOKEN fehlt in .env'); process.exit(1); }
const r = await fetch('https://discord.com/api/v10/applications/@me', { headers: { Authorization: `Bot ${t}` } });
if (!r.ok) { console.error(`Token ungültig (${r.status}) – im Developer Portal neu erzeugen.`); process.exit(1); }
const app = await r.json();
console.log(`OK: Bot "${app.name}" (${app.id})`);
console.log(`Einladen: https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot+applications.commands&permissions=309238696960`);
