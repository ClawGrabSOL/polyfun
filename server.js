const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = 8080;

// MIME types
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.ico': 'image/x-icon'
};

// Parse multipart form data
function parseMultipart(buffer, boundary) {
    const parts = [];
    const boundaryBuffer = Buffer.from('--' + boundary);
    
    let start = buffer.indexOf(boundaryBuffer) + boundaryBuffer.length + 2;
    
    while (start < buffer.length) {
        let end = buffer.indexOf(boundaryBuffer, start);
        if (end === -1) break;
        
        const part = buffer.slice(start, end - 2);
        const headerEnd = part.indexOf('\r\n\r\n');
        
        if (headerEnd !== -1) {
            const headers = part.slice(0, headerEnd).toString();
            const content = part.slice(headerEnd + 4);
            
            const nameMatch = headers.match(/name="([^"]+)"/);
            const filenameMatch = headers.match(/filename="([^"]+)"/);
            const contentTypeMatch = headers.match(/Content-Type: ([^\r\n]+)/);
            
            if (nameMatch) {
                parts.push({
                    name: nameMatch[1],
                    filename: filenameMatch ? filenameMatch[1] : null,
                    contentType: contentTypeMatch ? contentTypeMatch[1] : null,
                    data: content
                });
            }
        }
        
        start = end + boundaryBuffer.length + 2;
    }
    
    return parts;
}

// Rebuild multipart form data
function buildMultipart(parts, boundary) {
    const chunks = [];
    
    for (const part of parts) {
        chunks.push(Buffer.from(`--${boundary}\r\n`));
        
        if (part.filename) {
            chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`));
            if (part.contentType) {
                chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
            }
        } else {
            chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n`));
        }
        
        chunks.push(Buffer.from('\r\n'));
        chunks.push(part.data);
        chunks.push(Buffer.from('\r\n'));
    }
    
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    
    return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    
    // API proxy endpoints
    if (url.pathname === '/api/ipfs') {
        // Proxy to pump.fun IPFS upload
        console.log('Proxying IPFS upload to pump.fun...');
        
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            
            const proxyReq = https.request({
                hostname: 'pump.fun',
                port: 443,
                path: '/api/ipfs',
                method: 'POST',
                headers: {
                    'Content-Type': req.headers['content-type'],
                    'Content-Length': body.length,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Origin': 'https://pump.fun',
                    'Referer': 'https://pump.fun/create',
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'same-origin',
                    'Cookie': ''
                }
            }, (proxyRes) => {
                const responseChunks = [];
                proxyRes.on('data', chunk => responseChunks.push(chunk));
                proxyRes.on('end', () => {
                    const responseBody = Buffer.concat(responseChunks);
                    console.log('IPFS upload response:', proxyRes.statusCode, responseBody.toString().slice(0, 200));
                    res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
                    res.end(responseBody);
                });
            });
            
            proxyReq.on('error', (err) => {
                console.error('IPFS proxy error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            });
            
            proxyReq.write(body);
            proxyReq.end();
        });
        return;
    }
    
    if (url.pathname === '/api/trade') {
        // Proxy to pumpportal trade API
        console.log('Proxying trade request to pumpportal...');
        
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            console.log('Trade request body:', body.toString().slice(0, 500));
            
            const proxyReq = https.request({
                hostname: 'pumpportal.fun',
                port: 443,
                path: '/api/trade-local',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': body.length,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Origin': 'https://pumpportal.fun',
                    'Referer': 'https://pumpportal.fun/',
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            }, (proxyRes) => {
                const responseChunks = [];
                proxyRes.on('data', chunk => responseChunks.push(chunk));
                proxyRes.on('end', () => {
                    const responseBody = Buffer.concat(responseChunks);
                    console.log('Trade response:', proxyRes.statusCode, 'length:', responseBody.length);
                    
                    // Forward all headers
                    const headers = { ...proxyRes.headers };
                    delete headers['transfer-encoding'];
                    
                    res.writeHead(proxyRes.statusCode, headers);
                    res.end(responseBody);
                });
            });
            
            proxyReq.on('error', (err) => {
                console.error('Trade proxy error:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            });
            
            proxyReq.write(body);
            proxyReq.end();
        });
        return;
    }
    
    // Serve static files
    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    filePath = path.join(__dirname, filePath);
    
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not found');
            } else {
                res.writeHead(500);
                res.end('Server error');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n🚀 PolyFun server running at http://localhost:${PORT}\n`);
    console.log('Open this URL in Chrome to test with Phantom wallet\n');
});
