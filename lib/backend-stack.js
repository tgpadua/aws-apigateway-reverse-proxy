const fs = require('fs');
const cdk = require('aws-cdk-lib');
const ec2 = require('aws-cdk-lib/aws-ec2');
const iam = require('aws-cdk-lib/aws-iam');
const elbv2 = require('aws-cdk-lib/aws-elasticloadbalancingv2');
const elbv2_targets = require('aws-cdk-lib/aws-elasticloadbalancingv2-targets');

const USER_DATA_FILE = 'lib/backend-userdata.sh';

class BackendStack extends cdk.Stack {
    /**
     * @param {cdk.App} scope
     * @param {string} id
     */
    constructor(scope, id, props) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, `VpcBackend`, {
            ipAddresses: ec2.IpAddresses.cidr(props.backendVpcCidr),
            vpcName: 'backend',
            maxAzs: 2,
            subnetConfiguration: [
                {
                    name: 'backend-app',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                },
                {
                    name: 'backend-public',
                    subnetType: ec2.SubnetType.PUBLIC,
                }
            ]
        });

        const securityGroup = new ec2.SecurityGroup(this, 'BackendSecurityGroup', {
            vpc: vpc,
            securityGroupName: 'backendSecurityGroup'
        });
        securityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(443)); // all traffic inside VPC

        // Backend App
        const ami = new ec2.AmazonLinuxImage({
            generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
            cpuType: ec2.AmazonLinuxCpuType.ARM_64
        });

        const userData = ec2.UserData.forLinux();
        let data = fs.readFileSync(USER_DATA_FILE, 'utf8');
        data = data.replace('FQDN=',`FQDN=${props.backendFqdn}`);
        userData.addCommands(data);

        const role = new iam.Role(this, 'Ec2Role', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
        })
        role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'))

        const backendInstance = new ec2.Instance(this, 'BackendInstance', {
            instanceName: 'backend-app',
            vpc: vpc,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
            machineImage: ami,
            securityGroup: securityGroup,
            userData: userData,
            role: role
        });

        // Backend NLB
        const nlb = new elbv2.NetworkLoadBalancer(this, 'NLB', {
            vpc: vpc,
            loadBalancerName: 'nlb-backend',
            internetFacing: false,
            crossZoneEnabled: true,
        });

        const nlbListener = nlb.addListener(`NlbHttpsListener`, {
            port: 443,
            protocol: elbv2.Protocol.TLS,
            certificates: [props.certificate]
        });
        
        const nlbTargetGroup = new elbv2.NetworkTargetGroup(this, 'ApiTargetGroup', {
            targetGroupName: 'tg-backend',
            vpc: vpc,
            port: 443,
            targetType: elbv2.TargetType.IP,
            protocol: elbv2.Protocol.TLS,
            targets: [ new elbv2_targets.IpTarget(backendInstance.instancePrivateIp) ]
        });
        nlbListener.addTargetGroups('AddApiTargetGroup', nlbTargetGroup);        

        this.nlb = nlb; // expose nlb as a property
        
        new cdk.CfnOutput(this, 'BackendInstanceId', { value: backendInstance.instanceId });
    }
}

module.exports = { BackendStack }
