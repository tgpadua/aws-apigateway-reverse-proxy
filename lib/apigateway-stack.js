const cdk = require('aws-cdk-lib');
const cr = require('aws-cdk-lib/custom-resources');
const ec2 = require('aws-cdk-lib/aws-ec2');
const iam = require('aws-cdk-lib/aws-iam');
const elbv2 = require('aws-cdk-lib/aws-elasticloadbalancingv2');
const elbv2_targets = require('aws-cdk-lib/aws-elasticloadbalancingv2-targets');
const apigateway = require('aws-cdk-lib/aws-apigateway');

class ApiGatewayStack extends cdk.Stack {
    /**
     * @param {cdk.App} scope
     * @param {string} id
     */
    constructor(scope, id, props) {
        super(scope, id, props);

        const entryVpc = new ec2.Vpc(this, `EntryVpc`, {
            ipAddresses: ec2.IpAddresses.cidr(props.entryVpcCidr),
            vpcName: 'apigatewayEntry',
            maxAzs: 2,
            subnetConfiguration: [
                {
                    name: 'apigatewayEntry',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                }
            ]
        });

        const vpcEndpoint = entryVpc.addInterfaceEndpoint('ApiEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.APIGATEWAY
        });

        // Entry NLB
        const nlb = new elbv2.NetworkLoadBalancer(this, 'NlbEntryApiGateway', {
            vpc: entryVpc,
            loadBalancerName: 'nlb-entry-apigateway',
            internetFacing: false,
            crossZoneEnabled: true
        });

        const nlbListener = nlb.addListener(`NlbHttpsListener`, {
            port: 443,
            protocol: elbv2.Protocol.TLS,
            certificates: [props.certificate]
        });

        // Custom resource to retrieve Endpoint NIC IPs
        const getEndpointIp = new cr.AwsCustomResource(this, `GetEndpointIps`, {
            onUpdate: {
                service: 'EC2',
                action: 'describeNetworkInterfaces',
                parameters: { NetworkInterfaceIds: vpcEndpoint.vpcEndpointNetworkInterfaceIds },
                physicalResourceId: cr.PhysicalResourceId.of('EndpointNics'), // Update physical id to always fetch the latest version
            },
            policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
                resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
            }),
        });

        // Adds API Gateway Endpoints as targets of the NLB
        let nlbTargets = [];
        for (let i = 0; i <= vpcEndpoint.vpcEndpointNetworkInterfaceIds.length; i++) {
            let ipAddress = getEndpointIp.getResponseField(`NetworkInterfaces.${i}.PrivateIpAddress`);
            let ipTarget = new elbv2_targets.IpTarget(ipAddress);
            nlbTargets.push(ipTarget);
        }

        const nlbTargetGroup = new elbv2.NetworkTargetGroup(this, 'ApiGatewayTargetGroup', {
            targetGroupName: 'tg-apigateway',
            vpc: entryVpc,
            port: 443,
            targetType: elbv2.TargetType.IP,
            protocol: elbv2.Protocol.TLS,
            targets: nlbTargets,
            healthCheck: {
                protocol: elbv2.Protocol.HTTPS,
                path: '/ping',
                healthyHttpCodes: '200'
            }
        });
        nlbListener.addTargetGroups('AddApiGatewayTargetGroup', nlbTargetGroup);

        // Creates a endpoint service to expose the NLB to the client VPC through a PrivateLink
        const entryNlbEndpointService = new ec2.VpcEndpointService(this, `EntryNlbEndpointService`, {
            vpcEndpointServiceLoadBalancers: [nlb],
            acceptanceRequired: false,
        });

        const backendVpcLink = new apigateway.VpcLink(this, 'VPCLink', {
            vpcLinkName: 'nlb-backend',
            targets: [props.backendNlb],
        });

        const apiResourcePolicy = new iam.PolicyDocument({
            statements: [
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    principals: [new iam.StarPrincipal()],
                    actions: ['execute-api:Invoke'],
                    resources: ['execute-api:/*'],
                    conditions: {
                        StringEquals: {
                            'aws:sourceVpce': vpcEndpoint.vpcEndpointId
                        }
                    }
                })
            ]
        });

        const api = new apigateway.RestApi(this, `ApiGateway`, {
            restApiName: 'reverse-proxy',
            description: 'This service serves an internal api gateway',
            endpointConfiguration: {
                types: [apigateway.EndpointType.PRIVATE],
                vpcEndpoints: [vpcEndpoint]
            },
            policy: apiResourcePolicy,
            deployOptions: {
                stageName: 'dev',
                variables: {
                    'proxyFqdn': `${props.proxyFqdn}`
                }
            }
        });

        const baseIntegration = {
            type: apigateway.IntegrationType.HTTP_PROXY,
            integrationHttpMethod: 'ANY',
            options: {
                connectionType: apigateway.ConnectionType.VPC_LINK,
                vpcLink: backendVpcLink,
            },
            uri: 'https://${stageVariables.proxyFqdn}' // backend NLB share the same valid cert used by API Gateway
        }

        // create root resource
        let rootIntegrationProps = Object.assign({}, baseIntegration); // clone object
        api.root.addMethod('ANY', new apigateway.Integration(rootIntegrationProps));

        // create proxy resource
        let proxyIntegration = Object.assign({}, baseIntegration); // clone object
        proxyIntegration.uri += '/{proxy}';
        proxyIntegration.options.requestParameters = {
            "integration.request.path.proxy": "method.request.path.proxy"
        }

        api.root.addProxy({
            defaultIntegration: new apigateway.Integration(proxyIntegration),
            defaultMethodOptions: {
                methodResponses: [{ statusCode: '200' }],
                requestParameters: {
                    'method.request.path.proxy': true
                }
            }
        });

        // configure custom domain and map the API
        const domainName = new apigateway.DomainName(this, `ApiGatewayCustomDomain`, {
            domainName: props.proxyFqdn,
            certificate: props.certificate,
            endpointType: apigateway.EndpointType.REGIONAL,
            securityPolicy: apigateway.SecurityPolicy.TLS_1_2,
        });

        new apigateway.BasePathMapping(this, 'BasePathMapping', {
            domainName: domainName,
            restApi: api
        });

        // expose propertie(s)
        this.entryVpc = entryVpc; // required for cross-region
        this.entryVpcEndpointServiceName = entryNlbEndpointService.vpcEndpointServiceName;

        new cdk.CfnOutput(this, 'vpcEndpointServiceName', { value: entryNlbEndpointService.vpcEndpointServiceName });

    }
}

module.exports = { ApiGatewayStack }
