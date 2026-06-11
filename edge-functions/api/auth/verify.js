// edge-functions/api/auth/verify.js
export async function onRequestPost(context) {
    const { request, env } = context;
    const clientIp = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for') || '';

    // 【新增】简易限流：同一IP 1分钟最多5次密码尝试，防暴力破解
    const rateKey = `rate:login:${clientIp}`;
    try {
        const count = await dns_kv.get(rateKey);
        if (count && parseInt(count) >= 5) {
            return new Response(JSON.stringify({ error: "请求过于频繁，请1分钟后再试" }), {
                status: 429,
                headers: getBaseHeaders()
            });
        }
        await dns_kv.put(rateKey, count ? String(parseInt(count) + 1) : "1", { expirationTtl: 60 });
    } catch (e) {
        console.log("限流KV异常", e);
    }

    try {
        const body = await request.text();
        // 【新增】基础输入校验，防止恶意载荷
        if (!body || body.length > 512) {
            return new Response(JSON.stringify({ error: "请求内容非法" }), {
                status: 400,
                headers: getBaseHeaders()
            });
        }
        const { password } = JSON.parse(body);
        const accessPassword = (env.ACCESS_PASSWORD || "").trim();

        if (!accessPassword) {
            return new Response(JSON.stringify({ error: "未配置访问密码" }), {
                status: 400,
                headers: getBaseHeaders()
            });
        }

        if (password !== accessPassword) {
            return new Response(JSON.stringify({ error: "密码错误" }), {
                status: 401,
                headers: getBaseHeaders()
            });
        }

        // 【优化】加强 Token 随机性：时间戳 + 高强度随机串 + 盐值
        const timestamp = Date.now();
        const random = crypto.randomUUID().replace(/-/g, "") + Math.random().toString(36).slice(2);
        const token = `dns_${timestamp}_${random}`;
        const sessionKey = `session:${token}`;

        // 写入KV，会话24小时过期
        try {
            await dns_kv.put(sessionKey, "valid", { expirationTtl: 86400 });
        } catch (e) {
            console.log("会话存储失败", e);
        }

        // 【重点修复】Cookie 增加 HttpOnly / Secure / SameSite=Strict，抵御XSS+CSRF
        const cookieValue = `dns_session=${encodeURIComponent(token)}; Path=/; Max-Age=86400; SameSite=Strict; HttpOnly; Secure`;

        return new Response(JSON.stringify({
            success: true,
            message: "验证成功"
        }), {
            headers: {
                ...getBaseHeaders(),
                "Set-Cookie": cookieValue
            }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: "请求格式错误" }), {
            status: 400,
            headers: getBaseHeaders()
        });
    }
}

// 统一 OPTIONS 跨域处理
export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: getCorsHeaders()
    });
}

// 【统一基础响应头 + 安全头】
function getBaseHeaders() {
    return {
        "Content-Type": "application/json",
        // 安全响应头：防点击劫持、MIME嗅探、XSS
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "X-XSS-Protection": "1; mode=block",
        "Referrer-Policy": "strict-origin-when-cross-origin"
    };
}

// 【修复CORS】不使用 *，限制允许跨域（按需修改为你的域名）
function getCorsHeaders() {
    const base = getBaseHeaders();
    return {
        ...base,
        "Access-Control-Allow-Origin": "https://你的部署域名.com", // 替换为你的真实域名
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Access-Control-Allow-Credentials": "true"
    };
}
