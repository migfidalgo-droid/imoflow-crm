#!/bin/zsh

cd "$(dirname "$0")"

IP_ADDRESS=$(/sbin/ifconfig en0 2>/dev/null | /usr/bin/awk '/inet / {print $2; exit}')
if [ -z "$IP_ADDRESS" ]; then
  IP_ADDRESS="127.0.0.1"
fi

echo ""
echo "ImoFlow vai ficar disponivel nestes enderecos:"
echo "Neste computador: http://127.0.0.1:8765/"
echo "Na rede local:    http://${IP_ADDRESS}:8765/"
echo ""
echo "Mantem esta janela aberta enquanto utilizas o ImoFlow."
echo "Para desligar, fecha esta janela ou prime Control+C."
echo ""

/usr/bin/open "http://127.0.0.1:8765/" >/dev/null 2>&1 &
exec /usr/bin/ruby -run -e httpd . -p 8765 -b 0.0.0.0
