export default async function handler(req, res) {
    const target = req.query.url;

    // Block missing or non-TTC URLs — this proxy should only ever hit the TTC feed
    if (!target || !target.startsWith("https://webservices.umoiq.com/")) {
        res.status(400).json({ error: "Only TTC API URLs are allowed" });
        return;
    }

    try {
        const upstream = await fetch(target);

        // Forward the status code as-is
        res.status(upstream.status);

        // Pass through the content-type so the XML arrives correctly
        const contentType = upstream.headers.get("content-type");
        if (contentType) res.setHeader("Content-Type", contentType);

        // Stream the body straight back to the client
        const text = await upstream.text();
        res.send(text);
    } catch (err) {
        res.status(502).json({ error: "Upstream fetch failed", detail: err.message });
    }
}
