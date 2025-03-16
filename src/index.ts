import * as pulumi from "@pulumi/pulumi"; 
import * as gcp from "@pulumi/gcp"; 
import * as k8s from "@pulumi/kubernetes";
import * as auto from "@pulumi/pulumi/automation";
import * as bodyParser from 'body-parser';
import express, { Request, Response } from 'express';

const app = express();
const port = 8080;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// simple status endpoint test 
app.get('/status', (req: Request, res: Response) => {
    res.json({ status: 'ok', message: 'Pulumi automation API is up and running!' });
})


app.post('/deploy', async (req: Request, res: Response) => {
    try {
        console.log('starting deployment...');
        const result = await deployToGKE();
        res.json({
            success: true,
            message: 'Deployment successful',
            deploymentName: result.deploymentName,
            serviceEndpoint: result.serviceEndpoint
        });
    } catch (error) {
        console.error('Deployment failed:', error);
        res.json({
            success: false,
            message: 'Deployment failed'
        });
    }
});


async function deployToGKE() {
    // Define the GKE cluster that we are going to deploy apps and services to 

    const pulumiProgram = async () => {

        const cluster = await gcp.container.getCluster({
            name: "steam-simulation-cluster-1",
            location: "us-central1-a",
            project: "steameducation-b1b03"
        });

        // Generate kubeconfig for this cluster
        const kubeconfig = pulumi.all([cluster.name, cluster.endpoint, cluster.masterAuths]).apply(
            ([name, endpoint, masterAuths]) => {
                const masterAuth = masterAuths[0];
                const context = `${cluster.project}_${cluster.location}_${name}`;
                return `apiVersion: v1
                        clusters:
                        - cluster:
                            certificate-authority-data: ${masterAuth.clusterCaCertificate}
                            server: https://${endpoint}
                        name: ${context}
                        contexts:
                        - context:
                            cluster: ${context}
                            user: ${context}
                        name: ${context}
                        current-context: ${context}
                        kind: Config
                        preferences: {}
                        users:
                        - name: ${context}
                        user:
                            exec:
                            apiVersion: client.authentication.k8s.io/v1beta1
                            command: gke-gcloud-auth-plugin
                            installHint: Install gke-gcloud-auth-plugin for use with kubectl by following
                                https://cloud.google.com/blog/products/containers-kubernetes/kubectl-auth-changes-in-gke
                            provideClusterInfo: true`;
            }
        );

        // Create a Kubernetes provider instance that uses our cluster from above 
        const k8sProvider = new k8s.Provider("k8s-provider", {
            kubeconfig: kubeconfig,
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
                            image: "us-docker.pkg.dev/google-samples/containers/gke/hello-app:1.0",
                            ports: [{ name: "http", containerPort: 8080 }],
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
                ports: [{ port: 80, targetPort: 4200 },
                        { port: 70, targetPort: 9002 },
                        { port: 60, targetPort: 5000 },
                        { port: 50, targetPort: 8080 }
                ],
            },
        }, { provider: k8sProvider, parent: namespace });


        return { 
            deploymentName: deployment.metadata.name, 
            serviceIp: service.status.loadBalancer.ingress[0].ip 
        }; 
    }; 


    // Create or select a stack for managing this deployment
    const stack = await auto.LocalWorkspace.createOrSelectStack({
        stackName: "dev",
        projectName: "gke-deployment",
        program: pulumiProgram,
    });

    // Deploy the stack
    const result = await stack.up({ onOutput: console.log });
    console.log(`Deployment succeeded: ${result.outputs.deploymentName}`);
    console.log(`Service available at: http://${result.outputs.serviceEndpoint}`);

    return {
        deploymentName: result.outputs.deploymentName,
        serviceEndpoint: result.outputs.serviceIp 
    };
}

app.listen(port, () => {
    console.log(`Pulumi automation API listening at http://localhost:${port}`);
})