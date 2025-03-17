"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pulumi = __importStar(require("@pulumi/pulumi"));
const gcp = __importStar(require("@pulumi/gcp"));
const k8s = __importStar(require("@pulumi/kubernetes"));
const auto = __importStar(require("@pulumi/pulumi/automation"));
const bodyParser = __importStar(require("body-parser"));
const express_1 = __importDefault(require("express"));
const app = (0, express_1.default)();
const port = 8080;
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// simple status endpoint test 
app.get('/status', (req, res) => {
    res.json({ status: 'ok', message: 'Pulumi automation API is up and running!' });
});
app.post('/deploy', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log('starting deployment...');
        const result = yield deployToGKE();
        res.json({
            success: true,
            message: 'Deployment successful',
            deploymentName: result.deploymentName,
            serviceEndpoint: result.serviceEndpoint
        });
    }
    catch (error) {
        console.error('Deployment failed:', error);
        res.json({
            success: false,
            message: 'Deployment failed'
        });
    }
}));
function deployToGKE() {
    return __awaiter(this, void 0, void 0, function* () {
        // Define the GKE cluster that we are going to deploy apps and services to 
        const pulumiProgram = () => __awaiter(this, void 0, void 0, function* () {
            const cluster = yield gcp.container.getCluster({
                name: "steam-simulation-cluster-1",
                location: "us-central1-c",
                project: "steameducation-b1b03"
            });
            console.log(cluster);
            // Generate kubeconfig for this cluster
            const kubeconfig = pulumi.all([cluster.name, cluster.endpoint, cluster.masterAuths]).apply(([name, endpoint, masterAuths]) => {
                const masterAuth = masterAuths[0];
                const context = `${cluster.project}_${cluster.location}_${name}`;
                // Return a JSON string instead of YAML
                const kubeconfigObj = {
                    apiVersion: "v1",
                    kind: "Config",
                    current_context: context,
                    clusters: [
                        {
                            name: context,
                            cluster: {
                                "certificate-authority-data": masterAuth.clusterCaCertificate,
                                server: `https://${endpoint}`
                            }
                        }
                    ],
                    contexts: [
                        {
                            name: context,
                            context: {
                                cluster: context,
                                user: context
                            }
                        }
                    ],
                    users: [
                        {
                            name: context,
                            user: {
                                exec: {
                                    apiVersion: "client.authentication.k8s.io/v1beta1",
                                    command: "gke-gcloud-auth-plugin",
                                    installHint: "Install gke-gcloud-auth-plugin for use with kubectl by following https://cloud.google.com/blog/products/containers-kubernetes/kubectl-auth-changes-in-gke",
                                    provideClusterInfo: true
                                }
                            }
                        }
                    ]
                };
                return JSON.stringify(kubeconfigObj);
            });
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
            }, { provider: k8sProvider, parent: namespace });
            // Define the Kubernetes service 
            const service = new k8s.core.v1.Service("steam-simulation-service", {
                metadata: {
                    labels: appLabels,
                    namespace: namespace.metadata.name
                },
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
        });
        // Create or select a stack for managing this deployment
        const stack = yield auto.LocalWorkspace.createOrSelectStack({
            stackName: "dev",
            projectName: "gke-deployment",
            program: pulumiProgram,
        });
        // Deploy the stack
        const result = yield stack.up({ onOutput: console.log });
        console.log(`Deployment succeeded: ${result.outputs.deploymentName}`);
        console.log(`Service available at: http://${result.outputs.serviceEndpoint}`);
        return {
            deploymentName: result.outputs.deploymentName,
            serviceEndpoint: result.outputs.serviceIp
        };
    });
}
app.listen(port, () => {
    console.log(`Pulumi automation API listening at http://localhost:${port}`);
});
