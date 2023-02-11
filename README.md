# AWS API Gateway Reverse Proxy
Sample experimental CDK project using AWS API Gateway as a reverse proxy between VPCs.

- API is exposed using a private certificate (self-signed)
- Cross region is not implemented but could be achieveable through proper networking connectivity

# Architecture
(To be included)

# Config
Edit `bin/aws-apigateway-reverse-proxy.js` and replace place holder values `<...>`

# Deployment
Execute the deployment from the CLI with `cdk deploy --all --concurrency 50`

# Test
1. Connect in the client instance `aws ssm start-session --target <ClientInstanceId>`
2. Execute a cURL to the proxy endpoint `curl https://<proxy_fqdn>`

# Cleanup
```cdk destroy```

