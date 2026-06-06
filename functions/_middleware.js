// functions/_middleware.js
// 职责：1) 为前端提供密码验证API  2) 保护API路由  3) 静态文件放行

export default async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // ========== 1. API路由：检查会话有效性 ==========
    if (url.pathname.startsWith('/api/client/dnsopenapi/')) {
        // 如果配置了密码，验证会话
        const accessPassword = env.ACCESS_PASSWORD;
        if (accessPassword && accessPassword.trim() !== '') {
            const cookie = request.headers.get('cookie') || '';
            const sessionMatch = cookie.match(/dns_session=([^;]+)/);
            const sessionToken = sessionMatch ? decodeURIComponent(sessionMatch[1]) : null;
            
            let validSession = false;
            
            // 先检查KV（如果绑定了）
            if (sessionToken && env.dns_kv) {
                try {
                    const session = await env.dns_kv.get(`session:${sessionToken}`);
                    if (session === 'valid') validSession = true;
                } catch (e) {}
            }
            
            // KV未绑定或检查失败，降级检查Cookie本身（无服务器验证，依赖前端）
            if (!validSession && sessionToken) {
                // 检查是否是本函数发放的令牌格式（简单验证）
                validSession = sessionToken.startsWith('dns_');
            }
            
            if (!validSession) {
                return new Response(JSON.stringify({ error: '未授权，请先通过密码验证' }), {
                    status: 401,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
        }
        
        // 继续处理API代理
        return await handleApiProxy(context, request, env, url);
    }

    // ========== 2. 验证API：处理密码验证请求 ==========
    if (url.pathname === '/api/auth/verify') {
        return await handleAuthVerify(context, request, env);
    }

    // ========== 3. 检查会话状态API ==========
    if (url.pathname === '/api/auth/check') {
        return await handleAuthCheck(context, request, env);
    }

    // ========== 4. 其他所有请求放行（前端自己处理密码UI）==========
    return await context.next();
}

// 处理密码验证
async function handleAuthVerify(context, request, env) {
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const { password } = await request.json();
        const accessPassword = env.ACCESS_PASSWORD;

        if (!accessPassword || accessPassword.trim() === '') {
            return new Response(JSON.stringify({ error: '未配置访问密码' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (password === accessPassword) {
            // 生成会话令牌
            const timestamp = Date.now();
            const random = Math.random().toString(36).substring(2, 15);
            const token = `dns_${timestamp}_${random}`;
            
            // 存储到KV（如果绑定了）
            if (env.dns_kv) {
                try {
                    await env.dns_kv.put(`session:${token}`, 'valid', { expirationTtl: 86400 });
                } catch (e) {
                    console.log('KV store failed:', e);
                }
            }
            
            return new Response(JSON.stringify({ 
                success: true, 
                token,
                message: '验证成功'
            }), {
                headers: { 
                    'Content-Type': 'application/json',
                    'Set-Cookie': `dns_session=${encodeURIComponent(token)}; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly`
                }
            });
        } else {
            return new Response(JSON.stringify({ error: '密码错误' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    } catch (e) {
        return new Response(JSON.stringify({ error: '请求格式错误' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// 检查会话状态
async function handleAuthCheck(context, request, env) {
    const cookie = request.headers.get('cookie') || '';
    const sessionMatch = cookie.match(/dns_session=([^;]+)/);
    const sessionToken = sessionMatch ? decodeURIComponent(sessionMatch[1]) : null;
    
    let validSession = false;
    
    if (sessionToken && env.dns_kv) {
        try {
            const session = await env.dns_kv.get(`session:${sessionToken}`);
            if (session === 'valid') validSession = true;
        } catch (e) {}
    }
    
    // 降级：检查格式
    if (!validSession && sessionToken && sessionToken.startsWith('dns_')) {
        validSession = true;
    }
    
    return new Response(JSON.stringify({ 
        authenticated: validSession,
        hasPassword: !!(env.ACCESS_PASSWORD && env.ACCESS_PASSWORD.trim() !== '')
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

// API代理（原有逻辑）
async function handleApiProxy(context, request, env, url) {
    const API_BASE = env.DNS_API_BASE || 'vps8.zz.cd';
    const fullApiBase = API_BASE.startsWith('http') ? API_BASE : 'https://' + API_BASE;
    const targetUrl = new URL(url.pathname + url.search, fullApiBase);

    const headers = new Headers();
    const contentType = request.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType);

    const authHeader = request.headers.get('authorization');
    if (authHeader) {
        headers.set('Authorization', authHeader);
    } else {
        const envApiKey = env.DNS_API_KEY;
        if (envApiKey) {
            const credentials = 'client:' + envApiKey;
            const encoded = btoa(credentials);
            headers.set('Authorization', 'Basic ' + encoded);
        }
    }

    const newRequest = new Request(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.body
    });

    try {
        const response = await fetch(newRequest);
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        newHeaders.set('Access-Control-Allow-Credentials', 'true');
        newHeaders.set('Access-Control-Max-Age', '86400');

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: newHeaders });
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
        });
    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Proxy Error',
            message: error.message,
            target: targetUrl.toString()
        }), {
            status: 502,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
