// edge-functions/index.js - 处理根路径 /，重定向到 index.html
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // 只处理根路径 /
    if (url.pathname !== '/') {
        return new Response('Not Found', { status: 404 });
    }

    // 重定向到 /index.html（会经过 _middleware.js 验证）
    return Response.redirect(url.origin + '/index.html', 302);
}
