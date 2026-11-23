---
title: "Learning AWS on a Student Budget: Hands-on Cloud Without the Bill"
description: "You want to learn AWS, experiment with S3, Lambda, DynamoDB, SQS or build a complete Serverless system, but the moment you look at the Cloud bill you start to feel the pressure?"
slug: "hoc-aws-cho-sinh-vien-ngheo-vuot-kho-thuc-hanh-cloud-khong-lo-hoa-don"
locale: "en"
translationKey: "hoc-aws-cho-sinh-vien-ngheo-vuot-kho-thuc-hanh-cloud-khong-lo-hoa-don"
pubDate: 2026-11-23T14:22:21+07:00
category: "DevOps & Infrastructure"
tags: ["AWS"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 13
---

You want to learn AWS, try out S3, Lambda, DynamoDB, SQS or build a complete Serverless system, but the moment you look at a Cloud bill, the pressure starts to set in?

Learning and practising AWS sometimes comes with a very familiar worry: the Cloud cost.

You want to create a few resources to see how they work, experiment with a new architecture or build a small lab. But every time you use real AWS, you have to care about billing, usage time, Free Tier limits and cleaning up resources after the experiment.

Sometimes, what makes a developer hesitate is not how hard AWS is, but what it costs to experience it first-hand.

So is there a way to learn AWS, develop applications and experiment with Cloud services without constantly worrying about the bill?

An interesting combination has just appeared: **the official AWS Emulator from AWS and StackPort – an open-source project that provides a graphical interface for interacting with the AWS Emulator environment.**

This is a solution worth noting for anyone who wants to build a local AWS environment, practise AWS APIs and reduce costs during development.

![image.png](/images/articles/hoc-aws-cho-sinh-vien-ngheo-vuot-kho-thuc-hanh-cloud-khong-lo-hoa-don/figure-1.png)

---

## 1. AWS Emulator – When AWS can run right on your local machine

On 11/11/2026, AWS officially introduced AWS Emulator – a tool that lets developers run an environment simulating AWS APIs right on their local machine.

This is an exciting step for the local AWS development ecosystem.

Previously, when developing an application that used AWS, developers usually had to choose between connecting directly to real AWS or using third-party emulation solutions.

AWS Emulator offers another option: an emulator developed by AWS itself, using AWS APIs similar to the cloud environment.

Instead of sending requests to real AWS, you can point the AWS CLI or an AWS SDK at a local endpoint and perform operations on simulated resources.

For example, instead of creating an S3 bucket on real AWS:

```bash
aws s3 mb s3://my-test-bucket \
  --endpoint-url https://127.0.0.1:9297
```

You can perform the same operation right in the local environment.

A few capabilities worth noting:

- Run AWS API endpoints right on your local machine.
- Use the familiar AWS CLI and AWS SDKs.
- Create and work with resources supported by the emulator.
- Develop and test applications without sending requests to real AWS.
- Create multiple independent emulator environments for tests.
- Integrate into local development and CI workflows.

What's special is that AWS Emulator does not require you to have an AWS account to run.

According to AWS's announcement, the emulator has no additional service fee. You only pay for AWS resources when you actually deploy them to the AWS cloud.

This is very useful when you want to try out an idea, develop an application or run tests without needing to deploy real infrastructure yet.

**One important point:** AWS Emulator is not a complete copy of production AWS. Compatibility depends on each service and feature. For example, the emulator does not currently evaluate IAM policies the way real AWS does, and does not fully support cross-account or cross-Region behaviour.

Official documentation:

https://docs.aws.amazon.com/emulator/latest/userguide/

GitHub:

https://github.com/awslabs/aws-emulator

---

## 2. But AWS Emulator has one problem: No graphical interface!

That's quite interesting.

AWS Emulator provides an API endpoint that lets you interact through the AWS CLI or an SDK. The emulator itself, however, does not come with a graphical interface like the AWS Management Console.

That means if you want to check your resources, you usually have to use the terminal.

For example:

To list S3 buckets:

```bash
aws s3api list-buckets \
  --endpoint-url https://127.0.0.1:9297
```

To view DynamoDB tables:

```bash
aws dynamodb list-tables \
  --endpoint-url https://127.0.0.1:9297
```

To check SQS queues:

```bash
aws sqs list-queues \
  --endpoint-url https://127.0.0.1:9297
```

There is nothing wrong with the CLI. It is still a very familiar way of working for many backend developers and DevOps engineers.

However, when working with several services at once, having to constantly remember commands, check JSON responses and switch between the terminal and documentation can make the experience less than intuitive.

Especially when you want to explore a new service, a graphical interface makes learning and working with it much easier.

And that is exactly the gap StackPort fills.

---

## 3. StackPort – A Web interface for the official AWS Emulator

<escape>[StackPort](https://github.com/DaviReisVieira/stackport)</escape> is an open-source project that builds a web interface for exploring, managing and interacting with AWS resources.

What's notable is that StackPort integrates directly with **the official AWS Emulator from AWS**.

Before that, the market already had tools offering GUIs for local AWS environments, such as the LocalStack Web Application and other standalone dashboards.

StackPort is not the first tool to solve this problem.

What stands out about StackPort is that it supports several different emulators, including the AWS Emulator AWS has just introduced.

Instead of working only with the CLI, you can open a browser and manage your local AWS environment through a centralised interface.

<https://stackport.cloud/>

### 3.1. AWS Dashboard – See the whole environment

<https://stackport.cloud/docs/introduction/>

StackPort provides a dashboard for exploring 51 AWS services.

Instead of having to remember which service has which resources, you can see an overview of the services from one interface.

Some information you can observe:

- Service availability.
- Resource counts.
- Resource status.
- Service health.
- Resources that currently exist in the environment.

The dashboard also supports real-time status updates over WebSocket.

A useful point is that services not supported by the emulator are clearly marked, instead of being shown as if they were working normally.

### 3.2. S3 Browser – Manage Object Storage visually

<https://stackport.cloud/docs/service-browsers/s3/>

Instead of using the AWS CLI for every S3 operation, you can use the browser interface.

Notable features:

- View the list of buckets.
- Browse objects.
- Upload and download files.
- Navigate folders.
- View object information.
- Manage tags.
- Delete objects.

This is a fairly familiar experience if you have ever used the AWS S3 Console.

### 3.3. DynamoDB Browser – Work with a NoSQL Database

<https://stackport.cloud/docs/service-browsers/dynamodb/>

You can explore DynamoDB tables and work with data through the interface.

Some features:

- View the list of tables.
- Inspect table configuration.
- View and edit items.
- Query data.
- Check the partition key and attributes.

In particular, viewing data directly in the interface is much more convenient than constantly calling the CLI and reading JSON output.

### 3.4. Lambda Browser – Manage Serverless Functions

<https://stackport.cloud/docs/service-browsers/lambda/>

The Lambda Browser helps developers explore functions and some related information:

- Function configuration.
- Environment variables.
- Versions and aliases.
- Event sources.
- Invocation panel.

You can also invoke Lambda from the interface and check the execution result when the environment supports the corresponding operation.

### 3.5. SQS Browser – Observe Message Queues

<https://stackport.cloud/docs/service-browsers/sqs/>

For SQS, StackPort provides intuitive operations such as:

- View the list of queues.
- Check queue attributes.
- Send messages.
- Receive messages.
- Delete messages.

This is a useful tool when you are developing asynchronous processing systems or event-driven architectures.

### 3.6. API Explorer – Explore AWS APIs

This is one of the features I appreciate most.

AWS has thousands of API operations across many different services. Not every service has a dedicated management interface.

StackPort provides an API Explorer that lets developers call operations known to boto3 through an interface generated from the API model.

You can:

- Choose an AWS service.
- Choose an API operation.
- Enter parameters.
- Send the request.
- View the response.
- Copy the request as an AWS CLI command or boto3 code.

This is very useful when you want to explore AWS APIs without writing code for each experiment yourself.

Note: the API Explorer can display many operations, but successful execution still depends on what the emulator supports.

---

## 4. How does StackPort work with AWS Emulator?

What I like about the way StackPort integrates is that it does not need a separate plugin installed inside AWS Emulator.

StackPort communicates with the emulator through the standard AWS API, similar to how the AWS CLI and AWS SDKs interact.

You can picture the architecture like this:

```text
             Developer
                 |
                 v
          +--------------+
          |  StackPort   |
          |   Web UI     |
          +--------------+
                 |
                 v
          +--------------+
          |  StackPort   |
          |   Backend    |
          +--------------+
                 |
                 v
          +--------------+
          | AWS API /    |
          | boto3        |
          +--------------+
                 |
                 v
          +--------------+
          | AWS Emulator |
          | Official     |
          +--------------+
                 |
                 v
          +--------------+
          | Local AWS    |
          | Resources    |
          +--------------+
```

In terms of technology, StackPort uses:

- Python FastAPI for the backend.
- React and TypeScript for the frontend.
- AWS Cloudscape Design System for the interface.
- boto3 to communicate with AWS APIs.
- WebSocket for real-time data updates.

Cloudscape is also the design system AWS uses in many of its interface experiences.

Another important point: StackPort is an independent project, not an official Amazon product and not endorsed by AWS.

GitHub repository:

https://github.com/DaviReisVieira/stackport

---

## 5. Installation guide for AWS Emulator and StackPort

If you want to try this combination, you can start with Docker Compose.

### Step 1: Prepare the environment

You need:

- Docker.
- Docker Compose.
- Git or curl.

AWS Emulator has separate installation guides for Linux, macOS and Windows.

Documentation:

https://docs.aws.amazon.com/emulator/latest/userguide/getting-started.html

### Step 2: Download the Docker Compose configuration

Conveniently, the StackPort repository already provides a Docker Compose configuration specifically for AWS Emulator.

```bash
curl -O https://raw.githubusercontent.com/DaviReisVieira/stackport/main/examples/docker-compose.aws-emulator.yml
```

### Step 3: Start the environment

```bash
docker compose \
  -f docker-compose.aws-emulator.yml \
  up -d
```

Docker Compose will start the necessary components:

- AWS Emulator.
- StackPort.
- A seed container that creates some sample resources.

On the first run, building the AWS Emulator image may take extra time.

### Step 4: Access StackPort

Open your browser:

```text
http://localhost:8080
```

You will see a dashboard showing the AWS services and resources that exist in the local environment.

If the dashboard has no data yet, check the seed container:

```bash
docker compose \
  -f docker-compose.aws-emulator.yml \
  logs seed
```

### Step 5: Start exploring

Try creating an S3 bucket, adding a DynamoDB table or sending a test message to SQS.

All operations handled in the emulator environment will not create AWS resources on a real cloud account.

You can refer to StackPort's official integration guide at:

https://stackport.cloud/docs/guides/aws-emulator/

---

## 6. AWS labs you can build with StackPort

Having a local environment is a first step. What matters more is using it to practise scenarios close to real work.

Here are a few labs I think developers should try.

### Lab 1: Build a file storage system with S3

**Objective:** Get familiar with Object Storage and AWS S3 APIs.

Steps:

1. Create an S3 bucket.
2. Upload a file.
3. List the objects.
4. Download the file.
5. Check the metadata.
6. Delete the object and the bucket.

You can perform these operations through the StackPort UI and compare the results with the AWS CLI.

Through this exercise, you will understand how a backend application interacts with S3 instead of just reading documentation.

### Lab 2: Build a CRUD application with DynamoDB

**Objective:** Understand how a NoSQL database works on AWS.

Steps:

1. Create a DynamoDB table.
2. Set up the partition key.
3. Add some records.
4. Query the data.
5. Update an item.
6. Try conditional writes.

A fun exercise is to build a Todo application using DynamoDB as the database.

You can develop the backend with Java Spring Boot or Node.js and configure the AWS SDK to connect to the local endpoint.

### Lab 3: Build a background job processing system with SQS

**Objective:** Understand asynchronous processing.

Architecture:

```text
       API Application
              |
              v
         Send Message
              |
              v
           SQS Queue
              |
              v
        Background Worker
              |
              v
         Process Job
```

Practice:

- Create a queue.
- Send a message.
- Receive a message.
- Check message attributes.
- Try the visibility timeout.
- Delete the message after processing.

This is very useful knowledge when building backend systems with large workloads.

### Lab 4: Practise AWS Lambda

**Objective:** Get familiar with Serverless Computing.

Steps:

1. Create a Lambda function.
2. Configure the runtime.
3. Set up environment variables.
4. Invoke the function.
5. Check the execution result.
6. Observe the logs if the service supports them.

You can write the Lambda in Python, Java or Node.js and use the AWS SDK to interact with other services.

### Lab 5: Build an Event-Driven Architecture

**Objective:** Understand how AWS services work together.

A reference architecture:

```text
       File Upload
            |
            v
           S3
            |
            v
      Event Processing
            |
            v
           SQS
            |
            v
          Lambda
            |
            v
        DynamoDB
```

For example: when a file is uploaded, the system creates a processing job. The worker receives the message, processes the data and stores the result in DynamoDB.

You can build each component and check the API operations through StackPort.

Note that to run the whole flow automatically, the emulator must support the corresponding event integrations. If it does not yet, you can still practise each step by sending messages and invoking the function manually.

---

## 7. How are AWS Emulator and StackPort different from LocalStack?

This is an interesting question because LocalStack has been around for a long time and is widely used in the AWS developer community.

In reality, they are not entirely direct competitors at the same layer.

| Criterion | AWS Emulator | LocalStack | StackPort |
|---|---|---|---|
| Role | AWS API emulator | AWS API emulator | Web console |
| Developer | AWS | LocalStack | Independent project |
| CLI / SDK | Yes | Yes | Own API Explorer and CLI |
| Management GUI | No | Has its own GUI experiences | Yes |
| Purpose | Local testing | Local development/testing | Managing and exploring resources |
| Cost | No emulator fee | Tiered options available | MIT open-source |

An important point is that StackPort can connect to several emulators, including:

- AWS Emulator.
- LocalStack.
- MiniStack.
- Floci.
- Moto.

You do not have to pick just one emulator simply because you want to use StackPort.

If you are using the official AWS Emulator from AWS, StackPort can serve as the management interface for that environment.

If you are using LocalStack, you can also connect StackPort to LocalStack through the corresponding endpoint.

This is a considerable plus for developers who switch development environments often.

---

## 8. Limitations to know before using

Although AWS Emulator and StackPort are a notable combination, there are a few points to understand clearly.

**First: Not all AWS services are fully supported.**

AWS Emulator has varying service coverage and fidelity. An API appearing in the SDK or API Explorer does not mean the emulator has fully implemented the corresponding behaviour.

**Second: It does not fully replace production AWS.**

Some behaviours such as IAM policy evaluation, networking, cross-account, cross-Region and service quotas may differ from real AWS.

**Third: The GUI does not determine the emulator's accuracy.**

StackPort is an interface and management layer. The execution engine is still AWS Emulator.

**Fourth: Local does not mean absolutely no cost.**

AWS Emulator has no additional service fee and StackPort is released under the MIT License. However, you still need a machine, memory, CPU and storage space to run the containers.

For production environments, you should still test directly on real AWS before deploying.

---

## 9. Why is this a choice worth trying for developers?

I think the biggest value of this combination is not just saving money.

It also helps change how developers approach learning and building Cloud applications.

Instead of creating an AWS account, configuring billing, creating resources, checking permissions and cleaning up after every experiment, you can start with a local environment.

You can:

- Quickly try out an AWS API.
- Build prototypes using multiple AWS services.
- Write integration tests.
- Check how the backend interacts with the AWS SDK.
- Explore resource configurations.
- Create a local environment for CI.
- Try out multiple architectures without deploying constantly.

In particular, if you are a Java backend developer, you can build a Spring Boot application using S3, DynamoDB or SQS through the AWS SDK, then connect the application to AWS Emulator.

This is a very useful workflow for developing and testing an application before deploying it to real AWS.

---

## Conclusion

AWS Emulator and StackPort are a notable combination in the local AWS development ecosystem.

AWS provides an official emulator so developers can practise AWS APIs right on their local machine.

StackPort adds the missing experience: an intuitive web interface for exploring, managing and interacting with resources.

What I appreciate is that StackPort does not try to build yet another AWS emulator. Instead, the project relies on standard AWS APIs to support multiple emulators, including the official AWS Emulator from AWS.

If you are learning AWS, preparing for an AWS Certification or developing an application that uses AWS services, this is a toolkit well worth putting on your trial list.

You do not always need a real AWS account to start learning Cloud.

Sometimes, all you need is a good local environment, a few ideas to experiment with and enough patience to debug the first errors.

**Learning AWS doesn't need a fat wallet. What matters is being willing to practise! :))**

---

## Useful Resources

| Resource | Link |
|---|---|
| AWS Emulator | https://github.com/awslabs/aws-emulator |
| AWS Emulator Documentation | https://docs.aws.amazon.com/emulator/latest/userguide/ |
| StackPort GitHub | https://github.com/DaviReisVieira/stackport |
| StackPort Website | https://stackport.cloud/ |
| StackPort AWS Emulator Guide | https://stackport.cloud/docs/guides/aws-emulator/ |
| AWS
