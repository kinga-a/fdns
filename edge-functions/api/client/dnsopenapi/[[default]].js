// edge-functions/api/client/dnsopenapi/[[default]].js
export default async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // 验证会话（如果配置了密码）
    const accessPassword = env.ACCESS_PASSWORD;
    if (accessPassword && accessPassword.trim() !== '') {
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
        
        if (!validSession && sessionToken && sessionToken.startsWith('dns_')) {
            validSession = true;
        }
        
        if (!validSession) {
            return new Response(JSON.stringify({ error: '未授权访问' }), {
                status: 401,
                headers: { 
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }
    }

    // 处理备注相关请求
    const pathname = url.pathname;
    
    // 域名备注 API
    if (pathname.endsWith('/domain_remarks') || pathname.includes('/domain_remarks/')) {
        return handleRemarks(request, env, pathname);
    }

    // API代理逻辑
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

async function handleRemarks(request, env, pathname) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!env.dns_kv) {
        return new Response(JSON.stringify({ 
            error: 'KV 存储未配置',
            message: '请在 EdgeOne Pages 控制台绑定 dns_kv 命名空间'
        }), { status: 503, headers: corsHeaders });
    }

    try {
        const url = new URL(request.url);
        const domain = url.searchParams.get('domain');

        if (request.method === 'GET') {
            // 获取所有备注或指定域名备注
            if (domain) {
                const remark = await env.dns_kv.get(`remark:${domain}`);
                return new Response(JSON.stringify({ 
                    success: true, 
                    domain,
                    remark: remark || ''
                }), { headers: corsHeaders });
            } else {
                // 获取所有备注
                const list = await env.dns_kv.list({ prefix: 'remark:' });
                const remarks = {};
                for (const key of list.keys) {
                    const domainName = key.name.replace('remark:', '');
                    remarks[domainName] = await env.dns_kv.get(key.name);
                }
                return new Response(JSON.stringify({ 
                    success: true, 
                    remarks 
                }), { headers: corsHeaders });
            }
        }

        if (request.method === 'POST' || request.method === 'PUT') {
            const body = await request.json();
            if (!body.domain) {
                return new Response(JSON.stringify({ error: '缺少 domain 参数' }), { 
                    status: 400, 
                    headers: corsHeaders 
                });
            }
            await env.dns_kv.put(`remark:${body.domain}`, body.remark || '');
            return new Response(JSON.stringify({ 
                success: true, 
                message: '备注已保存',
                domain: body.domain,
                remark: body.remark || ''
            }), { headers: corsHeaders });
        }

        if (request.method === 'DELETE') {
            if (!domain) {
                return new Response(JSON.stringify({ error: '缺少 domain 参数' }), { 
                    status: 400, 
                    headers: corsHeaders 
                });
            }
            await env.dns_kv.delete(`remark:${domain}`);
            return new Response(JSON.stringify({ 
                success: true, 
                message: '备注已删除',
                domain
            }), { headers: corsHeaders });
        }

        return new Response(JSON.stringify({ error: '不支持的请求方法' }), { 
            status: 405, 
            headers: corsHeaders 
        });
    } catch (error) {
        return new Response(JSON.stringify({ 
            error: '备注操作失败',
            message: error.message 
        }), { status: 500, headers: corsHeaders });
    }
}
