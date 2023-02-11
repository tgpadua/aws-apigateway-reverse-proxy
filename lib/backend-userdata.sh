FQDN=

# install nodejs
curl -sL https://rpm.nodesource.com/setup_16.x | sudo bash -
yum install -y nodejs

# create cert
mkdir -p /opt/app/ssl
cd /opt/app
openssl req -x509 -newkey rsa:4096 -sha256 -nodes -keyout ssl/private.pem -out ssl/public.crt -days 365 -subj "/C=US/ST=CA/L=Santa Clara/O=Company Inc./OU=IT/CN=$FQDN"

# create app
cat <<EOF > index.js
const fs = require('fs')
const https = require('https')

var privateKey = fs.readFileSync('ssl/private.pem');
var certificate = fs.readFileSync('ssl/public.crt');

const PORT = 443;

async function processRequest(request, response) {
    response.end(new Date() +'\n');
}

https.createServer({key: privateKey, cert: certificate}, processRequest)
    .listen(PORT);
EOF

# add to instance bootstrap
echo "cd /opt/app && nohup node index.js > /var/log/app.log 2>&1 &" >> /etc/rc.d/rc.local
chmod +x /etc/rc.d/rc.local
/etc/rc.d/rc.local