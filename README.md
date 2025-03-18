# STEAM_IaC
This repository holds the code that will be hosted as a Cloud Run function on the GCP. The function will utilize the Pulumi Python library to manage the creation of Kubernetes services and pods on the Google Kubernetes Engine. 



**IaC**
This is the TypeScript file in the /src directory. It is responsible for deploying our STEAM simulation images, creating the ClusterIP service linked to each deployment, 
and for creating the HTTPRoute that connects the ClusterIP to the GKE Gateway API. 

**Gateway API** 
The Gateway API is created in GKE using the steam-regional-gateway.yaml file. The API is created using the command line, as far as I know it can't be made in the GCP console. 
You can also create it with Pulumi but I chose not to. Here are the steps to set it up in the future in case the current Gateway gets deleted: 
1. First you need to make sure you have the gcloud and kubectl command line tools installed
2. Connect kubectl to your GKE cluster with this command: 
    `gcloud container clusters get credentials <cluster_name> \
    --location <cluster_locaion>`
3. Create a static IP for the Gateway to use: 
    `gcloud compute addresses create <ip_address_name> \
    --region=<cluster_compute_region> \
    --network-tier=STANDARD`
4. Create a proxy subnet for your regional Gateway (don't let that scare you it's easy) 
    `gcloud compute networks subnets create proxy-only-subnet \
    --purpose=REGIONAL_MANAGED_PROXY \
    --role=ACTIVE \
    --region=us-central1 \
    --network=default \
    --range=192.168.0.0/23`
5. (MAYBE) You may need to create a namespace to put the Gateway API in if you don't have one yet. If you make it here just make sure you keep it consistent 
with everything else you make in this cluster just to make it easy on yourself. 
    `kubectl create namespace <namespace_name>`
6. Finally deploy the Gateway API with: 
    `kubectl apply -f steam-regional-gateway.yaml`