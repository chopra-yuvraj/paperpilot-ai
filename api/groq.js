export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const { model, messages, temperature, max_tokens } = req.body;
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: { message: "GROQ_API_KEY environment variable is missing" } });
    }

    try {
        const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model,
                messages,
                temperature,
                max_tokens
            })
        });

        if (!groqResponse.ok) {
            const errorData = await groqResponse.json().catch(() => ({}));
            return res.status(groqResponse.status).json(errorData);
        }

        const data = await groqResponse.json();
        return res.status(200).json(data);
    } catch (error) {
        console.error("Groq API error:", error);
        return res.status(500).json({ error: { message: "Failed to communicate with Groq API" } });
    }
}
