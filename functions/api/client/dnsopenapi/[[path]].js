export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    
    // 构建目标 URL
    const targetUrl = new URL('https://vps8.zz.cd' + url.pathname + url.search);
    
    // 复制请求头
    const headers = new Headers(request.headers);
    headers.delete('host'); // 移除原 host，让 fetch 自动设置
    
    // 创建新请求
    const newRequest = new Request(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.body,
        redirect: 'manual'
    });
    
    try {
        // 发送请求到目标 API
        const response = await fetch(newRequest);
        
        // 创建新响应，添加 CORS 头
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        newHeaders.set('Access-Control-Allow-Credentials', 'true');
        
        // 处理 OPTIONS 预检请求
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: newHeaders
            });
        }
        
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
        });
        
    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Proxy Error',
            message: error.message
        }), {
            status: 502,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
