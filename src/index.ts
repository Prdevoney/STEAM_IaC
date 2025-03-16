import * as pulumi from "@pulumi/pulumi"; 
import * as gcp from "@pulumi/gcp"; 
import * as k8s from "@pulumi/kubernetes";

// Define the GKE cluster that we are going to deploy apps and services to 
const cluster = gcp.container.getCluster({
    name: "steam-simulation-cluster-1",
    location: "us-central1-a",
});

// Create a Kubernetes provider instance that uses our cluster from above 
const k8sProvider = new k8s.Provider("gkeK8s", {
    kubeconfig: cluster.kubeConfigs[0].rawConfig,
});

// Create the Kubernetes namespace 
const namespace = new k8s.core.v1.Namespace("steam-simulation-namespace", {}, { provider: k8sProvider });

// Define the Kubernetes deployment
const appLabels = { app: "steam-simulation-app" }; 
const deployment = new k8s.apps.v1.Deployment("steam-simulation-deployment", {
    metadata: { namespace: namespace.metadata.name },
    spec: {
        replicas: 1,
        selector: { matchLabels: appLabels },
        template: {
            metadata: { labels: appLabels },
            spec: {
                containers: [{
                    name: "steam-simulation-app",
                    image: "gcr.io/steam-simulation/steam-simulation-app:latest",
                    ports: [{ containerPort: 8080 }],
                }],
            },
        },
    },
}, { provider: k8sProvider, parent: namespace});


// Define the Kubernetes service 
const service = new k8s.core.v1.Service("steam-simulation-service", {
    metadata: { 
        labels: appLabels,
        namespace: namespace.metadata.name },
    spec: {
        type: "LoadBalancer",
        selector: appLabels,
        ports: [{ port: 80, targetPort: 8080 }],
    },
}, { provider: k8sProvider, parent: namespace });
