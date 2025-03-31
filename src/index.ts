import * as pulumi from "@pulumi/pulumi"; 
import * as gcp from "@pulumi/gcp"; 
import * as k8s from "@pulumi/kubernetes";
import * as auto from "@pulumi/pulumi/automation";
import * as bodyParser from 'body-parser';
import express, { Request, Response } from 'express';

const app = express();
const port = 8080; 
process.env.PULUMI_ACCESS_TOKEN = process.env.PULUMI_ACCESS_TOKEN || '';
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const imageMap: Record<string, string> = {
    "test_world_image": "gcr.io/steameducation-b1b03/test_world_image@sha256:66a34ee0cf15b71aebe245fb8abbff44768eeec39b3ad85c386ce4e55113c6ad", // test_world_image:v6
    "1LjViNIEB14XNArQtwaP": "gcr.io/steameducation-b1b03/mod2_ros_intro@sha256:33d1fb3c43449af7cebe7a3cc5838b279211642f4f5f21f13b048a3840f1b3fc", // mod2_ros_intro:v6
    "neOI52gdX1HInFQgE8Mp": "gcr.io/steameducation-b1b03/mod3_robot_arm@sha256:acd7ab8b972432cc5738a659143123ee6aa772128239667a98110ac1426f4c94", // mod3_robot_arm:v2
    "bWSwj8u9RfeRd69jDkQ1": "gcr.io/steameducation-b1b03/mod4_tugbot@sha256:9c48a048be785f13c45ea2e8b401f3eaab07cf79666a2ce05e452dd0d739c46e", // mod4_tugbot:v1
    "hfQiob6b3V4WwvgcHyTf":"gcr.io/steameducation-b1b03/mod5_drone@sha256:96cc05f3848c85c97dfbf2531a3e2677346a567c789ce28ed38a230458296d89", // mod5_drone:v4
}; 

function getImage(key: string): string {
    return imageMap[key] || ""; 
}

const deploymentProgram = async (user_data: any) => {
    // Define the GKE cluster that we are going to deploy apps and services to 
    const user_id = user_data.user_id;
    const name = `simulation-${user_id}`;
    const namespace_name = "steam-namespace";
    const module_name = user_data.module_id; 
    const image = getImage(module_name); 
    const gateway_name = "steam-user-gateway"; 

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
                    namespace: namespace_name,
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
                                    image: image, // simulation image pulled from GCR
                                    ports: [
                                        { name: "sim-websocket", containerPort: 9002 },
                                        { name: "com-websocket", containerPort: 8002 },
                                        { name: "health-check", containerPort: 7002 },
                                    ],
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
                    namespace: namespace_name,
                },
                spec: {
                    type: "ClusterIP",
                    ports: [
                        { name: "simulation", port: 92, targetPort: "sim-websocket", protocol: "TCP", appProtocol: "kubernetes.io/ws" }, 
                        { name: "command", port: 82, targetPort: "com-websocket", protocol: "TCP", appProtocol: "kubernetes.io/ws" }, 
                        { name: "health", port: 72, targetPort: "health-check" }, // May not be necessary to expose this port on the ClusterIP service 
                    ],            
                    selector: appLabels,
                },
            },
            {
                provider: clusterProvider,
            }
        );

        // Create an HTTPRoute to route traffic to the Service
        const httpRoute = new k8s.apiextensions.CustomResource(
            `${user_id}-route`,
            {
                apiVersion: "gateway.networking.k8s.io/v1beta1", 
                kind: "HTTPRoute",
                metadata: {
                    namespace: namespace_name,
                },
                spec: {
                    parentRefs: [
                        {
                            name: gateway_name, // this references our STEAM gateway 
                            namespace: namespace_name,
                        }
                    ],
                    rules: [
                        {
                            // RULE ONE: Route traffic to the Ignition Gazebo Websocket (9002)
                            matches: [
                                {
                                    path: {
                                        type: "PathPrefix",
                                        value: `/${user_id}/${module_name}/simulation`,
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
                                    port: 92, // Simulation websocket exposed on ClusterIP 9002
                                }
                            ]
                        },
                        {
                            // RULE TWO: Route traffic to websocket that executes commands (8002)
                            matches: [
                                {
                                    path: {
                                        type: "PathPrefix",
                                        value: `/${user_id}/${module_name}/command`,
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
                                    },
                                
                                }
                            ],
                            backendRefs: [
                                {
                                    name: service.metadata.name,
                                    port: 82, // Command websocket exposed on ClusterIP 8002
                                }
                            ],
                        },
                    ]
                }
            },
            {
                provider: clusterProvider,
            }
        );

        const healthCheckPolicy = new k8s.apiextensions.CustomResource(
            `${user_id}-health-check-policy`,
            {
                apiVersion: "networking.gke.io/v1",
                kind: "HealthCheckPolicy",
                metadata: {
                    namespace: namespace_name,
                    name: `${user_id}-health-check`,
                },
                spec: {
                    default: {
                        checkIntervalSec: 60, 
                        timeoutSec: 55, 
                        healthyThreshold: 1, 
                        unhealthyThreshold: 10, 
                        logConfig: {
                            enabled: true,
                        },
                        config: {
                            type: "HTTP",
                            httpHealthCheck: {
                                port: 7002,
                                requestPath: "/",
                            },
                        },
                        
                    },
                    targetRef: {
                        group: "",
                        kind: "Service",
                        name: service.metadata.name,
                    }
                }
            },
            {
                provider: clusterProvider,
            }
        ); 

        const backendPolicy = new k8s.apiextensions.CustomResource(
            `${user_id}-backend-policy`,
            {
                apiVersion: "networking.gke.io/v1",
                kind: "GCPBackendPolicy",
                metadata: {
                    namespace: namespace_name,
                    name: `${user_id}-backend-policy`,
                },
                spec: {
                    default: {
                        timeoutSec: 3600,  // 1 hour
                    },
                    targetRef: {
                        group: "",
                        kind: "Service",
                        name: service.metadata.name,
                    }
                }
            },
            {
                provider: clusterProvider,
            }
        );


        // Export the Service 
        const serviceName = service.metadata.apply(m => m.name);

        return {
            namespace_name,
            deploymentName,
            serviceName,
        };
    }; 

    app.post('/deploy', async (req: Request, res: Response) => {
        try {
            // Set up Pulumi stack
            const projectName = "steam-simulation";
            const stackName = `stack-${req.body.user_id}`;
            
            // Initialize the stack with automation API
            const stack = await auto.LocalWorkspace.createOrSelectStack({
                projectName,
                stackName,
                program: () => deploymentProgram(req.body),
            });
            // Run update to deploy
            console.log("Starting deployment...");
            const upRes = await stack.up({ onOutput: console.log });

            // Return the outputs
            res.json({
                status: "success",
                message: "Deployment successful",
                outputs: upRes.summary,
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

    app.post('/', async (req: Request, res: Response) => {
        res.status(200).send('service is running'); 
    });

    // Add this endpoint after your /deploy endpoint
    app.post('/destroy', async (req: Request, res: Response) => {
        try {
            // Get user_id from request body
            const userId = req.body.user_id;
            if (!userId) {
                return res.status(400).json({
                    status: "error",
                    message: "Missing user_id in request body"
                });
            }

            // Set up Pulumi stack
            const projectName = "steam-simulation";
            const stackName = `stack-${userId}`;
            
            console.log(`Attempting to destroy stack: ${stackName}`);
            
            // Initialize the stack with automation API
            const stack = await auto.LocalWorkspace.selectStack({
                projectName,
                stackName,
                program: () => deploymentProgram({ user_id: userId, module_id: '' }), // Empty module_id since we're just destroying
            });

            // Run destroy to remove all resources
            console.log("Starting destruction...");
            const destroyRes = await stack.destroy({ onOutput: console.log });

            res.json({
                status: "success",
                message: `Stack ${stackName} destroyed successfully`,
                summary: destroyRes.summary
            });
        } catch (error: any) {
            console.error("Destruction failed:", error);
            res.status(500).json({
                status: "error",
                message: "Destruction failed",
                error: error.message
            });
        }
    });


app.listen(port, () => {
    console.log(`Pulumi automation API listening at http://localhost:${port}`);
})