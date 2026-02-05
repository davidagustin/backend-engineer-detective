import type { DetectiveCase } from '../../types';

export const kubernetesNodeNotReady: DetectiveCase = {
  id: 'kubernetes-node-not-ready',
  title: 'The Node NotReady Nightmare',
  subtitle: 'Nodes randomly becoming NotReady and evicting pods',
  difficulty: 'mid',
  category: 'distributed',

  crisis: {
    description: `Nodes in your Kubernetes cluster are randomly transitioning to NotReady state. When a node goes NotReady, all pods are evicted and rescheduled, causing service disruptions. The nodes eventually recover, but the cycle repeats every few hours.`,
    impact: `Services experiencing periodic disruptions. Pod evictions causing connection drops. Stateful workloads losing data. On-call team exhausted from alerts every 2-3 hours.`,
    timeline: [
      { time: '8:00 AM', event: 'All nodes healthy', type: 'normal' },
      { time: '10:23 AM', event: 'Node worker-3 transitions to NotReady', type: 'warning' },
      { time: '10:28 AM', event: 'Pods evicted from worker-3, rescheduled', type: 'critical' },
      { time: '10:35 AM', event: 'worker-3 recovers to Ready', type: 'normal' },
      { time: '1:15 PM', event: 'Node worker-1 transitions to NotReady', type: 'warning' },
    ]
  },

  symptoms: {
    working: [
      'Nodes eventually recover to Ready state',
      'SSH access to nodes works during NotReady',
      'kubelet process is running on affected nodes',
      'Network connectivity between nodes seems fine',
      'Control plane (API server, etcd) is healthy'
    ],
    broken: [
      'Nodes randomly go NotReady every 2-3 hours',
      'Node conditions show various pressure conditions',
      'Pods evicted and rescheduled during events',
      'Different nodes affected at different times',
      'Problem started after cluster expansion last week'
    ]
  },

  clues: [
    {
      id: 1,
      title: 'Node Status',
      type: 'logs',
      content: `\`\`\`
$ kubectl get nodes
NAME       STATUS     ROLES    AGE   VERSION
master-1   Ready      master   90d   v1.28.0
master-2   Ready      master   90d   v1.28.0
master-3   Ready      master   90d   v1.28.0
worker-1   Ready      <none>   90d   v1.28.0
worker-2   Ready      <none>   90d   v1.28.0
worker-3   NotReady   <none>   90d   v1.28.0
worker-4   Ready      <none>   7d    v1.28.0
worker-5   Ready      <none>   7d    v1.28.0

$ kubectl describe node worker-3 | grep -A15 Conditions:
Conditions:
  Type                 Status  Reason
  ----                 ------  ------
  MemoryPressure       False   KubeletHasSufficientMemory
  DiskPressure         True    KubeletHasDiskPressure
  PIDPressure          False   KubeletHasSufficientPID
  Ready                False   KubeletNotReady

Events:
  Type     Reason                Age   Message
  ----     ------                ----  -------
  Warning  NodeNotReady          5m    Node worker-3 status is now: NodeNotReady
  Warning  EvictionThresholdMet  6m    Eviction threshold met: nodefs.available<15%
\`\`\``,
      hint: 'DiskPressure is True...'
    },
    {
      id: 2,
      title: 'Node Disk Usage',
      type: 'metrics',
      content: `\`\`\`
# Checking disk usage on worker-3
$ ssh worker-3 "df -h"
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1       100G   94G  6.0G  94% /
/dev/sdb1       500G   45G  455G   9% /data

$ ssh worker-3 "du -sh /var/lib/docker/*"
2.1G    /var/lib/docker/containers
78G     /var/lib/docker/overlay2
1.2G    /var/lib/docker/image
4.5G    /var/lib/docker/volumes

$ ssh worker-3 "docker system df"
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          147       23        45.2GB    32.1GB (71%)
Containers      45        23        8.5GB     6.2GB (72%)
Local Volumes   12        8         4.5GB     1.2GB (26%)
Build Cache     89        0         18.3GB    18.3GB
\`\`\``,
      hint: 'Look at the root filesystem usage and Docker storage...'
    },
    {
      id: 3,
      title: 'Kubelet Configuration',
      type: 'config',
      content: `\`\`\`yaml
# /var/lib/kubelet/config.yaml on worker nodes
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
evictionHard:
  imagefs.available: "15%"
  memory.available: "100Mi"
  nodefs.available: "10%"
  nodefs.inodesFree: "5%"
evictionSoft:
  imagefs.available: "20%"
  memory.available: "200Mi"
  nodefs.available: "15%"
  nodefs.inodesFree: "10%"
evictionSoftGracePeriod:
  imagefs.available: "1m"
  memory.available: "1m"
  nodefs.available: "1m"
  nodefs.inodesFree: "1m"
imageGCHighThresholdPercent: 85
imageGCLowThresholdPercent: 80
\`\`\``,
      hint: 'Eviction thresholds are configured for disk space...'
    },
    {
      id: 4,
      title: 'Image Pull History',
      type: 'logs',
      content: `\`\`\`
$ ssh worker-3 "docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' | head -20"
myregistry/api-service:v2.3.45        1.2GB
myregistry/api-service:v2.3.44        1.2GB
myregistry/api-service:v2.3.43        1.2GB
myregistry/api-service:v2.3.42        1.2GB
myregistry/api-service:v2.3.41        1.2GB
myregistry/web-frontend:v4.5.67       850MB
myregistry/web-frontend:v4.5.66       850MB
myregistry/web-frontend:v4.5.65       848MB
myregistry/data-processor:v1.2.30     2.1GB
myregistry/data-processor:v1.2.29     2.1GB
...

$ ssh worker-3 "docker images | wc -l"
148
\`\`\``,
      hint: 'Many versions of the same images are stored...'
    },
    {
      id: 5,
      title: 'Ops Engineer Testimony',
      type: 'testimony',
      content: `"We added worker-4 and worker-5 last week because we needed more capacity. They have larger root volumes (200GB vs 100GB on the older nodes). The old nodes were sized for when we had fewer services and smaller images."

"We deploy multiple times a day, and each deployment pulls new images. The image garbage collection is supposed to clean up old images, but it seems like it's not keeping up. The newer nodes are fine because they have more disk space."`,
      hint: 'Older nodes have smaller root volumes...'
    },
    {
      id: 6,
      title: 'Container Runtime Logs',
      type: 'logs',
      content: `\`\`\`
$ ssh worker-3 "journalctl -u kubelet | grep -i 'disk\\|evict\\|image' | tail -20"
Mar 15 10:20:00 worker-3 kubelet: I0315 10:20:00.123 disk_manager.go:234]
  Disk usage: 94% (threshold: 85%)
Mar 15 10:20:00 worker-3 kubelet: W0315 10:20:00.124 eviction_manager.go:345]
  eviction manager: attempting to reclaim nodefs
Mar 15 10:20:01 worker-3 kubelet: I0315 10:20:01.567 image_gc_manager.go:289]
  attempting to free 8589934592 bytes (images using 48318382080 bytes)
Mar 15 10:20:02 worker-3 kubelet: I0315 10:20:02.890 image_gc_manager.go:301]
  deleted image sha256:abc123 (1.2GB freed)
Mar 15 10:22:00 worker-3 kubelet: W0315 10:22:00.111 eviction_manager.go:456]
  eviction manager: still under pressure after image GC, evicting pods
Mar 15 10:22:01 worker-3 kubelet: I0315 10:22:01.222 eviction_manager.go:567]
  evicting pod api-service-7d4f8b9c5-abc12
\`\`\``,
      hint: 'Image GC is running but not freeing enough space...'
    }
  ],

  solution: {
    diagnosis: 'Node disk pressure caused by accumulation of container images exceeding root volume capacity',
    keywords: [
      'node', 'notready', 'disk pressure', 'eviction', 'image gc', 'garbage collection',
      'nodefs', 'kubelet', 'docker', 'overlay2', 'disk space'
    ],
    rootCause: `The older worker nodes (worker-1, worker-2, worker-3) have 100GB root volumes, while Docker stores images in /var/lib/docker/overlay2 on the root filesystem. With frequent deployments pulling new images (many versions of large images), disk usage grows continuously.

The kubelet's image garbage collection has thresholds (imageGCHighThresholdPercent: 85, imageGCLowThresholdPercent: 80), but with 147 images totaling 45GB and only 32GB reclaimable, GC can't free enough space fast enough. When disk usage crosses the eviction threshold (nodefs.available: 15%), the node starts evicting pods. Eventually, the soft threshold (15%) plus eviction frees enough space for the node to recover, but the cycle repeats as new images are pulled.

The newer nodes (worker-4, worker-5) have 200GB volumes and haven't hit this threshold yet.`,
    codeExamples: [
      {
        lang: 'bash',
        description: 'Immediate fix: Clean up disk space on affected nodes',
        code: `# Run on affected worker nodes
# Remove unused Docker resources
docker system prune -af --volumes

# Remove old/unused images more aggressively
docker image prune -af --filter "until=24h"

# Clean up dangling volumes
docker volume prune -f

# Clear old container logs
find /var/lib/docker/containers -name "*.log" -type f -size +100M -delete

# Clean up old kubelet logs
journalctl --vacuum-size=500M

# Verify disk space freed
df -h /`
      },
      {
        lang: 'yaml',
        description: 'Adjust kubelet garbage collection thresholds',
        code: `# /var/lib/kubelet/config.yaml
apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration

# More aggressive image garbage collection
imageGCHighThresholdPercent: 70   # Start GC at 70% (was 85%)
imageGCLowThresholdPercent: 50    # Target 50% after GC (was 80%)

# Adjusted eviction thresholds
evictionHard:
  imagefs.available: "20%"        # More headroom (was 15%)
  nodefs.available: "15%"         # More headroom (was 10%)

evictionMinimumReclaim:
  imagefs.available: "10%"        # Reclaim at least 10%
  nodefs.available: "10%"`
      },
      {
        lang: 'yaml',
        description: 'Add container log rotation limits',
        code: `# /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "storage-opts": [
    "overlay2.override_kernel_check=true"
  ]
}

# Or in containerd config (for newer clusters)
# /etc/containerd/config.toml
[plugins."io.containerd.grpc.v1.cri"]
  max_container_log_line_size = 16384
  [plugins."io.containerd.grpc.v1.cri".containerd]
    [plugins."io.containerd.grpc.v1.cri".containerd.default_runtime]
      runtime_type = "io.containerd.runc.v2"`
      },
      {
        lang: 'bash',
        description: 'Automated cleanup CronJob',
        code: `# Create a DaemonSet to run periodic cleanup on all nodes
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-disk-cleanup
  namespace: kube-system
spec:
  selector:
    matchLabels:
      name: node-disk-cleanup
  template:
    metadata:
      labels:
        name: node-disk-cleanup
    spec:
      hostPID: true
      containers:
      - name: cleanup
        image: docker:24-cli
        command:
        - /bin/sh
        - -c
        - |
          while true; do
            echo "Running cleanup at \$(date)"
            docker image prune -af --filter "until=48h"
            docker container prune -f
            sleep 3600  # Run every hour
          done
        volumeMounts:
        - name: docker-sock
          mountPath: /var/run/docker.sock
      volumes:
      - name: docker-sock
        hostPath:
          path: /var/run/docker.sock
      tolerations:
      - operator: Exists
EOF`
      }
    ],
    prevention: [
      'Right-size node root volumes for expected image storage needs',
      'Configure more aggressive image GC thresholds in kubelet',
      'Implement container log rotation with size limits',
      'Monitor node disk usage and alert before eviction thresholds',
      'Use image pull policies that limit local image accumulation',
      'Consider separate volumes for /var/lib/docker'
    ],
    educationalInsights: [
      'Kubelet eviction thresholds protect nodes but can cause cascading failures',
      'Image garbage collection runs lazily - it may not keep up with rapid deployments',
      'Node NotReady can be caused by various resource pressures, not just network issues',
      'Disk pressure affects all pods on a node, including critical system pods',
      'Node sizing should account for container runtime storage needs'
    ]
  }
};
