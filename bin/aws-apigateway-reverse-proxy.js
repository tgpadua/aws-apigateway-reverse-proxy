#!/usr/bin/env node
const cdk = require('aws-cdk-lib');

const { CertificateStack } = require('../lib/certificate-stack');
const { BackendStack } = require('../lib/backend-stack');
const { ApiGatewayStack } = require('../lib/apigateway-stack');
const { ClientStack } = require('../lib/client-stack');

const CLIENT_VPC_ENV = { account: '<ACCOUNT_ID>', region: '<REGION>' };
const DEPLOYMENTS = [
    {
        env: { account: '<ACCOUNT_ID>', region: '<REGION>' },
        proxyHostname: 'app',
        entryVpcCidr: '172.16.1.0/24'        
    }
];

const HOSTED_ZONE_ID = 'XXXXXXXXXXXXXXXXXXXX'; // route53 zone id used for issue a valid certificate for the proxy
const PROXY_DOMAIN_NAME = 'proxy.domain.com'; // must be a subdomain of existing hosted zone
const BACKEND_FQDN = 'backend.internal.com'; // host with a self-signed certificate

const CLIENT_VPC_CIDR = '172.16.0.0/24';
const BACKEND_VPC_CIDR = '172.16.100.0/24';

const app = new cdk.App();

for (let deployment of DEPLOYMENTS) {
    let proxyFqdn = `${deployment.proxyHostname}.${PROXY_DOMAIN_NAME}`;

    let certificate = new CertificateStack(app, `${deployment.proxyHostname}-CertificateStack`, {
        env: deployment.env,
        hostedZoneId: HOSTED_ZONE_ID,
        proxyFqdn: proxyFqdn
    });

    let backend = new BackendStack(app, `${deployment.proxyHostname}-BackendStack`, {
        env: deployment.env,
        backendVpcCidr: BACKEND_VPC_CIDR,
        certificate: certificate.certificate,
        backendFqdn: BACKEND_FQDN
    });

    let apigateway = new ApiGatewayStack(app, `${deployment.proxyHostname}-ApiGatewayStack`, {
        backendNlb: backend.nlb,
        env: deployment.env,
        entryVpcCidr: deployment.entryVpcCidr,
        certificate: certificate.certificate,
        proxyFqdn: proxyFqdn,
        backendFqdn: BACKEND_FQDN
    });

    // extend the deployment with entry vpc and NLB properties, this is used by client vpc to establish connectivity
    deployment.entryVpc = apigateway.entryVpc;
    deployment.entryVpcEndpointServiceName = apigateway.entryVpcEndpointServiceName;
};

new ClientStack(app, 'ClientStack', {
    deployments: DEPLOYMENTS,
    env: CLIENT_VPC_ENV,
    clientVpcCidr: CLIENT_VPC_CIDR,
    proxyDomainName: PROXY_DOMAIN_NAME
});