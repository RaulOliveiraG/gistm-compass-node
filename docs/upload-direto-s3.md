# Upload direto para o S3

A importação envia cada arquivo direto do navegador para o bucket, com URL assinada (PUT), sem passar pelo servidor. Assim entram arquivos de até 1 GB. Arquivos com mais de 200 MB entram sem leitura de texto, para não estourar a memória do servidor.

Para funcionar, o bucket precisa aceitar PUT do domínio da plataforma (CORS). Sem isso, o botão volta sozinho para o envio pelo servidor (limite de 50 MB por arquivo).

Exemplo de configuração de CORS do bucket:

```json
[
  {
    "AllowedOrigins": ["https://gistm-compass.vwkjwn7k37z9m.us-east-1.cs.amazonlightsail.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

No console da AWS: S3 → bucket → Permissions → Cross-origin resource sharing (CORS) → Edit. Inclua também o domínio definitivo quando houver. Com `aws` CLI: `aws s3api put-bucket-cors --bucket <bucket> --cors-configuration file://cors.json` (o arquivo no formato `{"CORSRules": [...]}`).

Com STORAGE_DRIVER=local (desenvolvimento) o envio direto não existe e tudo vai pelo servidor.
