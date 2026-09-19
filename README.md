# SharkBot → Android Widget

## 1. Deploy the server
Railway can deploy this Node/Express service and provide a public HTTPS domain.

Create:
- one Node service from this folder
- one PostgreSQL database

Set these service variables:
- `DATABASE_URL` = Railway reference to the Postgres database
- `SHARKBOT_WEBHOOK_SECRET` = the Secret generated in SharkBot
- `WIDGET_KEY` = a long random string

After deployment, generate a public domain. Your webhook URL will be:

`https://SEU-DOMINIO/webhook/sharkbot`

Your widget API will be:

`https://SEU-DOMINIO/api/stats`

## 2. Configure SharkBot
In SharkBot:
- Webhooks → Novo Webhook
- Name: Widget Android
- URL: `https://SEU-DOMINIO/webhook/sharkbot`
- Secret: use Generate and copy the generated value into `SHARKBOT_WEBHOOK_SECRET`
- Event: Pagamento Aprovado

Do not paste the secret into chat.

## 3. Test
Open:
`https://SEU-DOMINIO/health`

It should return:
`{"ok":true}`

Then create a real/test approved payment in the way supported by your SharkBot account. The server will count it only if it can find an amount field.

IMPORTANT: The exact SharkBot payload shown by your account was not available in the screenshot, so `extractPayment()` is intentionally tolerant. If SharkBot uses a different amount field, adjust that function using the "Exemplo de Payload" shown in the dashboard. Do not use undocumented SharkBot endpoints or scraping.
