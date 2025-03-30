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

const imageMap: Record<string, string> = {
    "test_world_image": "gcr.io/steameducation-b1b03/test_world_image@sha256:202e9fd312666ab79400936e3d29395674f9d867bbc0e48831aa251492c2f6a4", // test_world_image
    "test_world_image_2": "gcr.io/steameducation-b1b03/test_world_image@sha256:66a34ee0cf15b71aebe245fb8abbff44768eeec39b3ad85c386ce4e55113c6ad", // test_world_image_2
    "1LjViNIEB14XNArQtwaP": "gcr.io/steameducation-b1b03/mod2_ros_intro@sha256:88573e759454d17c55214e4fc3c163a1a29aecb371eaf92c6639e5508e3ec44c", // mod2_ros_intro
    "neOI52gdX1HInFQgE8Mp": "gcr.io/steameducation-b1b03/mod3_robot_arm@sha256:10cedd0fb278053bbd1dce4789380007583553ec145dc40ae8b262a8cbcde8f6", // mod3_robot_arm
    "bWSwj8u9RfeRd69jDkQ1": "", // mod4_tugbot
    "hfQiob6b3V4WwvgcHyTf":"gcr.io/steameducation-b1b03/mod5_drone@sha256:ff05604b4e3d7babadb0a36ab7e30697727442ef80605f3c0f2310ec18d1708b", // mod5_drone
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
                        { name: "health", port: 72, targetPort: "health-check" },
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