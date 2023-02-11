const cdk = require('aws-cdk-lib');
const ec2 = require('aws-cdk-lib/aws-ec2');
const route53 = require('aws-cdk-lib/aws-route53');
const route53_targets = require('aws-cdk-lib/aws-route53-targets');
const iam = require('aws-cdk-lib/aws-iam');

class ClientStack extends cdk.Stack {
    /**
     * @param {cdk.App} scope
     * @param {string} id
     */
    constructor(scope, id, props) {
        super(scope, id, props);

        const clientVpc = new ec2.Vpc(this, `ClientVpc`, {
            ipAddresses: ec2.IpAddresses.cidr(props.clientVpcCidr),
            vpcName: 'client',
            maxAzs: 2,
            subnetConfiguration: [
                {
                    name: 'client',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED
                }
            ]
        });

        const zone = new route53.PrivateHostedZone(this, 'HostedZone', {
            zoneName: props.proxyDomainName,
            vpc: clientVpc
        });

        // iterate over each environment and establish connectivity with them
        for (let deployment of props.deployments) {
            // if the deployment region is different from the client region a network connectivity must be created
            if (props.env.region != deployment.env.region) {
                throw Error(`Cross region deployment is not supported yet: ${deployment.proxyHostname} -> ${deployment.env.region}`);
            }

            // temp just to deploy and debug
            if (props.env.region == deployment.env.region) {
                let interfaceVpcEndpoint = new ec2.InterfaceVpcEndpoint(this, `VPCEndpoint-${deployment.proxyHostname}`, {
                    vpc: clientVpc,
                    //service: new ec2.InterfaceVpcEndpointService(deployment.entryNlbEndpointService.vpcEndpointServiceName, 443)
                    service: new ec2.InterfaceVpcEndpointService(deployment.entryVpcEndpointServiceName, 443)
                });

                new route53.ARecord(this, `AliasRecord-${deployment.proxyHostname}`, {
                    recordName: deployment.proxyHostname,
                    zone,
                    target: route53.RecordTarget.fromAlias(new route53_targets.InterfaceVpcEndpointTarget(interfaceVpcEndpoint)),
                });

                new cdk.CfnOutput(this, `Alias-${deployment.proxyHostname}`, { value: `${deployment.proxyHostname}.${props.proxyDomainName}` });
            }
        }

        // Test EC2 Instance Deployment
        const securityGroup = new ec2.SecurityGroup(this, 'ClientSecurityGroup', {
            vpc: clientVpc,
            securityGroupName: 'clientSecurityGroup'
        });
        securityGroup.addIngressRule(ec2.Peer.ipv4(clientVpc.vpcCidrBlock), ec2.Port.tcp(443)); // all traffic inside VPC           

        clientVpc.addInterfaceEndpoint('BackendSsmEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SSM,
            securityGroups: [securityGroup]
        });

        clientVpc.addInterfaceEndpoint('BackendSsmMessagesEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
            securityGroups: [securityGroup]
        });

        clientVpc.addInterfaceEndpoint('Ec2MessagesEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
            securityGroups: [securityGroup]
        });

        const ami = new ec2.AmazonLinuxImage({
            generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
            cpuType: ec2.AmazonLinuxCpuType.ARM_64
        });

        const role = new iam.Role(this, 'Ec2Role', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
        })
        role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'))

        const clientInstance = new ec2.Instance(this, 'ClientInstance', {
            instanceName: 'client',
            vpc: clientVpc,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
            machineImage: ami,
            securityGroup: securityGroup,
            role: role
        });

        new cdk.CfnOutput(this, 'ClientInstanceId', { value: clientInstance.instanceId });
    }
}

module.exports = { ClientStack }