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
const deploymentProgram = () => __awaiter(void 0, void 0, void 0, function* () {
    // Define the GKE cluster that we are going to deploy apps and services to 
    const name = "helloworld";
    const cluster = yield gcp.container.getCluster({
        name: "steam-simulation-cluster-1",
        location: "us-central1-c",
        project: "steameducation-b1b03"
    });
    // Manufacture a GKE-style kubeconfig. Note that this is slightly "different"
    // because of the way GKE requires gcloud to be in the picture for cluster
    // authentication (rather than using the client cert/key directly).
    const kubeconfig = pulumi.
        all([cluster.name, cluster.endpoint, cluster.masterAuths]).
        apply(([name, endpoint, masterAuths]) => {
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
    // Create a Kubernetes Namespace
    const ns = new k8s.core.v1.Namespace(name, {}, { provider: clusterProvider });
    // Export the Namespace name
    const namespaceName = ns.metadata.apply(m => m.name);
    // Create a Deployment
    const appLabels = { appClass: name };
    const deployment = new k8s.apps.v1.Deployment(name, {
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
                                { name: "angular-port", containerPort: 4200 },
                                { name: "api-port", containerPort: 9002 },
                                { name: "web-port", containerPort: 8080 },
                                { name: "backend-port", containerPort: 5000 }
                            ]
                        }
                    ],
                }
            }
        },
    }, {
        provider: clusterProvider,
    });
    // Export the Deployment name
    const deploymentName = deployment.metadata.apply(m => m.name);
    // Create a LoadBalancer Service for the NGINX Deployment
    const service = new k8s.core.v1.Service(name, {
        metadata: {
            labels: appLabels,
            namespace: namespaceName,
        },
        spec: {
            type: "LoadBalancer",
            ports: [
                { name: "angular", port: 80, targetPort: "angular-port" },
                { name: "api", port: 70, targetPort: "api-port" },
                { name: "web", port: 60, targetPort: "web-port" },
                { name: "backend", port: 50, targetPort: "backend-port" }
            ], selector: appLabels,
        },
    }, {
        provider: clusterProvider,
    });
    // Export the Service name and public LoadBalancer endpoint
    const serviceName = service.metadata.apply(m => m.name);
    const servicePublicIP = service.status.apply(s => s.loadBalancer.ingress[0].ip);
    return {
        namespaceName,
        deploymentName,
        serviceName,
        servicePublicIP,
    };
});
app.post('/deploy', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Set up Pulumi stack
        const projectName = "steam-simulation";
        const stackName = req.body.stackName;
        // Initialize the stack with automation API
        const stack = yield auto.LocalWorkspace.createOrSelectStack({
            projectName,
            stackName,
            // Specify our program directly
            program: deploymentProgram,
        });
        // Run update to deploy
        console.log("Starting deployment...");
        const upRes = yield stack.up({ onOutput: console.log });
        // Return the outputs
        res.json({
            status: "success",
            message: "Deployment successful",
            outputs: upRes.outputs,
        });
    }
    catch (error) {
        console.error("Deployment failed:", error);
        res.status(500).json({
            status: "error",
            message: "Deployment failed",
            error: error.message,
        });
    }
}));
app.listen(port, () => {
    console.log(`Pulumi automation API listening at http://localhost:${port}`);
});
