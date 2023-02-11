const cdk = require('aws-cdk-lib');
const route53 = require('aws-cdk-lib/aws-route53');
const certificatemanager = require('aws-cdk-lib/aws-certificatemanager');

class CertificateStack extends cdk.Stack {
    /**
     * @param {cdk.App} scope
     * @param {string} id
     */
    constructor(scope, id, props) {
        super(scope, id, props);
        
        const zone = route53.HostedZone.fromHostedZoneId(this, `HostedZone`, props.hostedZoneId);
        const certificate = new certificatemanager.Certificate(this, `Certificate`, {
            domainName: props.proxyFqdn,
            validation: certificatemanager.CertificateValidation.fromDns(zone)
          });

        this.certificate = certificate;
    }
}

module.exports = { CertificateStack }
