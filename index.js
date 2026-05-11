const fs = require('fs/promises');
const { SocksClient } = require('socks');

var Proxies = 'Proxy.txt';
var BLACKLIST_FILE = 'blacklist.txt';

let pod = `
tw6q4cLM:6sCGERutml@51.147.127.71:50101
yuriilp4p:TxWga7PsNX@42.153.72.211:50101
`;


function rand() {
    return Math.floor(Math.random() * 255);
}

function toProxyString(p) {
    return `socks5://${p.login}:${p.pass}@${p.ip}:${p.port}`;
}

function buildSubnets(podString) {
    // Build subnets
    const map = new Map();

    const lines = podString
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

    for (const line of lines) {
        const [auth, host] = line.split('@');
        const [login, pass] = auth.split(':');
        const [ip, port] = host.split(':');

        const parts = ip.split('.');
        const subnet = `${parts[0]}.${parts[1]}`;

        if (!map.has(subnet)) {
            map.set(subnet, {
                login,
                pass,
                port: Number(port)
            });
        }
    }

    return map;
}

function generateFromSubnet(subnet, config) {
    return {
        ip: `${subnet}.${rand()}.${rand()}`,
        port: config.port,
        login: config.login,
        pass: config.pass
    };
}

async function testProxy(proxy) {
    try {
        const start = Date.now();

        const conn = await SocksClient.createConnection({
            proxy: {
                host: proxy.ip,
                port: proxy.port,
                type: 5,
                userId: proxy.login,
                password: proxy.pass
            },
            command: 'connect',
            destination: {
                host: '1.1.1.1',
                port: 443
            },
            timeout: 3000
        });

        const latency = Date.now() - start;

        try { conn.socket.destroy(); } catch {}

        return { ok: true, latency };

    } catch (e) {
        return { ok: false, error: e.code || e.message };
    }
}

async function loadSet(file) {
    try {
        const data = await fs.readFile(file, 'utf8');
        return new Set(data.split('\n').filter(Boolean));
    } catch {
        return new Set();
    }
}

async function append(file, line) {
    await fs.appendFile(file, line + '\n');
}

async function runPool(tasks, limit) {
    let index = 0;

    async function worker() {
        while (index < tasks.length) {
            const task = tasks[index++];
            await task();
        }
    }

    await Promise.all(
        Array.from({ length: limit }, worker)
    );
}

(async () => {
    var subnets = buildSubnets(pod);

    var proxySet = await loadSet(Proxies);
    let blacklistSet = await loadSet(BLACKLIST_FILE);

    const stats = {
        total: 0,
        added: 0,
        failed: 0
    };

    var tasks = [];

    for (let i = 0; i < 10000; i++) {
        for (const [subnet, config] of subnets) {
            tasks.push(async () => {
                let gen = generateFromSubnet(subnet, config);
                let proxyString = toProxyString(gen);

                if (proxySet.has(proxyString)) return;

                let result = await testProxy(gen);

                stats.total++;

                if (result.ok) {
                    await append(Proxies, proxyString);
                    proxySet.add(proxyString);
                    stats.added++;
                } else {
                    if (!blacklistSet.has(gen.ip)) {
                        await append(BLACKLIST_FILE, gen.ip);
                        blacklistSet.add(gen.ip);
                    }
                    stats.failed++;
                }

                console.log(`[${stats.total}]`, result);
            });
        }
    }

    await runPool(tasks, 50);

    console.log("Done parsing, results:");
    console.log(stats);
})();