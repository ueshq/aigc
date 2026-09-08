#!/bin/sh
set -eu
export KUBECONFIG=/opt/aigc-deploy/renew-kubeconfig
K=/opt/aigc-deploy/kubectl
$K create secret tls aigc-tls -n aigc \
  --cert=/opt/aigc-deploy/tls/tls.crt --key=/opt/aigc-deploy/tls/tls.key \
  --dry-run=client -o json | $K replace -f -
