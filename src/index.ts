import * as pulumi from "@pulumi/pulumi"; 
import * as gcp from "@pulumi/gcp"; 
import * as k8s from "@pulumi/kubernetes";
import * as auto from "@pulumi/pulumi/automation";
import * as bodyParser from 'body-parser';
import express, { Request, Response } from 'express';

const app = express();
const port = 9090; 

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


const deploymentProgram = async (user_data: any) => {
    // Define the GKE cluster that we are going to deploy apps and services to 
    const user_id = user_data.user_id
    const name = `steam-simulation-${user_id}`;
    const namespaceName = "steam-namespace";

    const cluster = await gcp.container.getCluster({
        name: "steam-simulation-cluster-1",
        location: "us-central1-c",
        project: "steameducation-b1b03"
    });


// Manufacture a GKE-style kubeconfig. Note that this is slightly "different"
// because of the way GKE requires gcloud to be in the picture for cluster
// authentication (rather than using the client cert/key directly).
const kubeconfig = pulumi.
    all([ cluster.name, cluster.endpoint, cluster.masterAuths ]).
    apply(([ name, endpoint, masterAuths ]) => {
        const context = `${gcp.config.project}_${gcp.config.zone}_${name}`;
        const masterAuth = masterAuths[0];
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
      provideClusterInfo: true
`;
    });

        // Create a Kubernetes provider instance that uses our cluster from above.
        const clusterProvider = new k8s.Provider(name, {
            kubeconfig: kubeconfig,
        });

        // Create a Deployment
        const appLabels = { appClass: name };
        const deployment = new k8s.apps.v1.Deployment(name,
            {
                metadata: {
                    namespace: namespaceName,
                    labels: appLabels,
                },
                spec: {
                    replicas: 1,
                    selector: { matchLabels: appLabels },
                    template: {
                        metadata: {
                            labels: appLabels,
                        },
                        spec: {
                            containers: [
                                {
                                    name: name,
                                    image: "gcr.io/steameducation-b1b03/steam_images/gazebo_web_simulation@sha256:2be74a2fa44d543b4ebae2f1ff51aaed45f01d083a4ddb5ca30fedd57ef59c00",
                                    ports: [
                                        { name: "simulation-websocket", containerPort: 9002 },
                                        { name: "command-websocket", containerPort: 8002 },
                                    ]
                                }
                            ],
                        }
                    }
                },
            },
            {
                provider: clusterProvider,
            }
        );


        // Export the Deployment name
        const deploymentName = deployment.metadata.apply(m => m.name);

        // Create a ClusterIP service for the Deployment
        const service = new k8s.core.v1.Service(name,
            {
                metadata: {
                    labels: appLabels,
                    namespace: namespaceName,
                },
                spec: {
                    type: "ClusterIP",
                    ports: [
                        { name: "simulation", port: 90, targetPort: "simulation-websocket" }, 
                        { name: "command", port: 80, targetPort: "command-websocket" }, 
                    ],            selector: appLabels,
                },
            },
            {
                provider: clusterProvider,
            }
        );

        // Create an HTTPRoute to route traffic to the Service
        const httpRoute = new k8s.apiextensions.CustomResource(
            `user-${user_id}-route`,
            {
                apiVersion: "gateway.networking.k8s.io/v1beta1", 
                kind: "HTTPRoute",
                metadata: {
                    namespace: namespaceName,
                },
                spec: {
                    parentRefs: [
                        {
                            name: "steam-user-gateway", // this references our STEAM gateway 
                            namespace: namespaceName,
                        }
                    ],
                    rules: [
                        {
                            // RULE ONE: Route traffic to the Ignition Gazebo Websocket (9002)
                            matches: [
                                {
                                    path: {
                                        type: "PathPrefix",
                                        value: `/user/${user_id}/simulation`,
                                    }
                                }
                            ],
                            filters: [
                                {
                                    type: "URLRewrite",
                                    urlRewrite: {
                                        path: {
                                            type: "ReplacePrefixMatch",
                                            replacePrefixMatch: "/",
                                        }
                                    }
                                }
                            ],
                            backendRefs: [
                                {
                                    name: service.metadata.name,
                                    port: 90, // Simulation websocket exposed on ClusterIP 9002
                                }
                            ]
                        },
                        {
                            // RULE TWO: Route traffic to websocket that executes commands (8002)
                            matches: [
                                {
                                    path: {
                                        type: "PathPrefix",
                                        value: `/user/${user_id}/command`,
                                    }
                                }
                            ],
                            filters: [
                                {
                                    type: "URLRewrite",
                                    urlRewrite: {
                                        path: {
                                            type: "ReplacePrefixMatch",
                                            replacePrefixMatch: "/",
                                        }
                                    }
                                }
                            ],
                            backendRefs: [
                                {
                                    name: service.metadata.name,
                                    port: 80, // Command websocket exposed on ClusterIP 8002
                                }
                            ]
                        }
                    ]
                }
            },
            {
                provider: clusterProvider,
            }
        );

        // Export the Service 
        const serviceName = service.metadata.apply(m => m.name);

        return {
            namespaceName,
            deploymentName,
            serviceName,
        };
    }; 

    app.post('/deploy', async (req: Request, res: Response) => {
        try {
            // Set up Pulumi stack
            const projectName = "steam-simulation";
            const stackName = `user-stack${req.body.user_id}`;
            
            // Initialize the stack with automation API
            const stack = await auto.LocalWorkspace.createOrSelectStack({
                projectName,
                stackName,
                // Specify our program directly
                program: () => deploymentProgram(req.body),
            });
            // Run update to deploy
            console.log("Starting deployment...");
            const upRes = await stack.up({ onOutput: console.log });

            // Return the outputs
            res.json({
                status: "success",
                message: "Deployment successful",
                outputs: upRes.outputs,
            });
        } catch (error: any) {
            console.error("Deployment failed:", error);
            res.status(500).json({
                status: "error",
                message: "Deployment failed",
                error: error.message,
            });
        }
    });


app.listen(port, () => {
    console.log(`Pulumi automation API listening at http://localhost:${port}`);
})