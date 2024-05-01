# Resolve the domain name to an IP address
resolved_ip=$(dig +short mud.paramud.com)

# Redirect outgoing TCP traffic to the resolved IP address and port 23 to your application listening on another port (e.g., 8080)
sudo iptables -t nat -A OUTPUT -p tcp -d $resolved_ip --dport 23 -j REDIRECT --to-port 31000
sudo iptables -t nat -A OUTPUT -p tcp -d $resolved_ip --dport 2427 -j REDIRECT --to-port 31000

# ./proxy

# Delete the previously added iptables rule
sudo iptables -t nat -D OUTPUT -p tcp -d $resolved_ip --dport 23 -j REDIRECT --to-port 31000
sudo iptables -t nat -D OUTPUT -p tcp -d $resolved_ip --dport 2427 -j REDIRECT --to-port 31000
