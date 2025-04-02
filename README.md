# STEAM_IaC
This repository holds the code that will be hosted as a Cloud Run function on the Google Cloud Platform (GCP). The function will utilize the Pulumi TypeScript library to manage the creation of Kubernetes services and pods on the Google Kubernetes Engine (GKE). This type of software is know as Infrastructure as Code (IaC). 

## IaC
This is the TypeScript file in the /src directory. It is responsible for deploying our STEAM simulation images, creating the ClusterIP service linked to each deployment, 
and for creating the HTTPRoute that connects the ClusterIP to the GKE Gateway API. 
### Endpoints: 
#### `/deploy`: This launches all the resourses for a user
```
JSON
{
    "user_id": <user_id>,
    "module_id": <module_id>
}
```
#### `/desroy`: This destroys all the resourses created for a user 
```
JSON
{
    "user_id": <user_id>
}
```

### Resources Created: 
1) **Workload Deployment:** <br>
This is the actual container that can be found in the Workloads tab in the GKE. 
2) **ClusterIP:** <br>
This is the service that links to the deployment. It allows it to connect to the load balancer. This can be found in the Gateways tab under Services in the GKE console. 
3) **HTTPRoute:** <br>
These are the routes that expose the websockets in a users container to the internet. The endpoints created will always be of the form `/<user_id>/<module_id>/simulation` & `/<user_id>/<module_id>/command`. This can be found in the Gateways tab under Routes in the GKE console. 
4) **Health Check Policy** <br>
For a load balancer to route traffic to a service, the CluserIP, the endpoints in that service need to return a status of 200 when sent an HTTP request. Our app however consists of two websockets, which do not return a status of 200 when called successfully. To fix this we added a simple HTTP server to each container image and created the health check policy to route the checks to that endpoint and not the websockets. 
5) **Backend Policy** <br> 
When a loadbalancer sends traffic to an endpoint is has a timeout of 30 seconds, which is typical for HTTP requests. However our endpoints are websockets; so, we need a connection that lasts much longer than 30 seconds. The backend policy allows the connection to remain open for one hour. 

## Gateway API
The Gateway API is what allows us to route traffic from a user to their own isolated instance of the simulation we have running in the cloud for them. Here's the flow:<br> 
`Client -> Load Balancer -> Gateway -> HTTPRoute -> ClusterIP Service -> Users unique container instance (pod)` <br><br>
The Gateway API is created in GKE using the `steam-regional-gateway.yaml` file. The gateway API is created using the command line, as far as I know it can't be made in the GCP console. 
You can also create it with Pulumi but I chose not to. Here are the steps to set it up in the future in case the current Gateway gets deleted: 
1. First you need to make sure you have the gcloud and kubectl command line tools installed 
2. Then if not completed already you have to enable the Gateway API for the cluster you are using. 
    ```
    gcloud container clusters update <cluster_name> \
        --location=<cluster_location> \
        --gateway-api=STANDARD 
    ```
3. Connect kubectl to your GKE cluster with this command: <br>
    ```
    gcloud container clusters get credentials <cluster_name> \
        --location <cluster_locaion> 
    ```
4. Create a static IP for the Gateway to use: <br>
    ```
    gcloud compute addresses create <ip_address_name> \
        --region=<cluster_compute_region> \
        --network-tier=STANDARD
    ```
5. Create a proxy subnet for your regional Gateway <br>
    ```
    gcloud compute networks subnets create proxy-only-subnet \
        --purpose=REGIONAL_MANAGED_PROXY \
        --role=ACTIVE \
        --region=us-central1 \
        --network=default \
        --range=192.168.0.0/23
    ```
6. (MAYBE) You may need to create a namespace to put the Gateway API in if you don't have one yet. The one we are currently using is `steam-namespace`. If you make it here just make sure you keep it consistent 
with everything else you make in this cluster just to make it easy on yourself. <br>
    ```
    kubectl create namespace <namespace_name>
    ```
7. Finally deploy the Gateway API with: <br>
    ```
    kubectl apply -f steam-regional-gateway.yaml
    ```
You now have a Gateway API that will allow you to route traffic from the internet to any of the ClusterIP services you link an HTTPRoute to. 

## Dockerfile