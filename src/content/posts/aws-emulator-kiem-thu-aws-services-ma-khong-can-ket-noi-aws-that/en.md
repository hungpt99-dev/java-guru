---
title: "AWS Emulator — Testing AWS Services Without Connecting to Real AWS"
description: "When building an application that uses AWS, writing the code is sometimes not the part that takes the most time. The challenge usually lies in the testing and integration process with external services."
slug: "aws-emulator-kiem-thu-aws-services-ma-khong-can-ket-noi-aws-that"
locale: "en"
translationKey: "aws-emulator-kiem-thu-aws-services-ma-khong-can-ket-noi-aws-that"
pubDate: 2026-11-12T10:34:12+07:00
category: "DevOps & Infrastructure"
tags: ["AWS", "Cloud Computing", "Testing"]
featured: false
draft: false
series: null
coverImage: "./cover.png"
readingTime: 24
---

## 1. Introduction – Testing AWS Services without connecting to real AWS

When building an application that uses AWS, writing the code is sometimes not the part that takes the most time. The challenge usually lies in the testing and integration process with external services.

For example, a Spring Boot application might use Amazon S3 to store files, Amazon SQS to process messages asynchronously, DynamoDB to store data, SNS to send notifications, or EventBridge to orchestrate events between the components in the system.

In the production environment, these services run on the AWS Cloud. But during development, developers still need a way to check the integration logic before deploying the application to the real environment.

Usually, we have a few options:

- Use a separate AWS account for Development.
- Create resources on AWS and then test directly.
- Mock the AWS SDK in Unit Tests.
- Use tools that simulate AWS Services running on the local machine.

Each approach has its own pros and cons. Using real AWS gives higher confidence about the environment, but it requires managing credentials, resources, cost and the cleanup process. Mocking, meanwhile, makes tests fast but does not guarantee behavior that matches real AWS.

In particular, with systems that use many AWS Services, testing a single business flow can involve quite a few preparation steps.

For example, an order processing flow might need:

1. Upload a file to S3.
2. Send a message to SQS.
3. The worker receives the message and processes it.
4. Save the state to DynamoDB.
5. Publish an event via SNS or EventBridge.

If every logic change has to be deployed or have resources created on AWS just to check it, the development loop becomes slower.

So is there a way to develop and test the AWS integration parts right on your own machine, without constantly creating resources on real AWS?

That is exactly the problem **AWS Emulator** is aimed at.

## 2. What is AWS Emulator?

On 11/11/2026, AWS introduced AWS Emulator – a tool that lets you run an environment simulating the AWS API right on the local machine or in a CI environment.

Put simply, AWS Emulator creates a local endpoint so the application can send requests through the AWS SDK or AWS CLI just like when communicating with real AWS.

Instead of sending requests to the AWS Cloud, requests are routed to the AWS Emulator running on the developer's machine.

What stands out is that developers do not need to rewrite the integration logic or change how they use the AWS SDK. The application still uses the same familiar APIs, but the destination of the request is switched to the local environment.

AWS Emulator has a few characteristics:

- Does not require an AWS account to use.
- No need to deploy resources to the AWS Cloud.
- No additional emulator service fee.
- Supports the AWS SDK and AWS CLI.
- Can run on the developer's machine or in CI/CD.
- The resources created live in the emulator environment, not on real AWS.

This lets developers test the AWS integration parts right during development, instead of having to wait until deployment to the Cloud.

## 3. How does AWS Emulator work?

To understand it better, let's look at how a normal application communicates with AWS.

### 3.1. Communication flow with real AWS

In the production environment, the flow usually looks like this:

**Application → AWS SDK → AWS API → AWS Service**

For example, when the application needs to upload a file to Amazon S3:

1. The application calls the upload method through the AWS SDK.
2. The SDK builds an HTTP request following the structure of the S3 API.
3. The SDK signs the request with AWS Signature Version 4.
4. The request is sent to the AWS API.
5. S3 processes the request and returns the response.

Developers do not need to build the HTTP request directly or handle the whole communication protocol with AWS. That work is handled by the AWS SDK.

### 3.2. Communication flow with AWS Emulator

When using AWS Emulator, the communication flow changes:

**Application → AWS SDK → AWS Emulator → Local Resource State**

Instead of sending requests to the AWS Cloud, the SDK sends requests to the emulator's local endpoint.

AWS Emulator receives the request, handles the corresponding API and returns the response to the application.

On the application side, the way the SDK is used barely changes. The main difference is the endpoint the SDK connects to.

According to the AWS documentation, the emulator uses a default HTTPS endpoint at `https://127.0.0.1:9297`.

On startup, the emulator creates its own credentials, configuration and certificate. Requests sent to the emulator are signed with credentials provided by the emulator itself.

This keeps the local environment separate from the real AWS account.

### 3.3. How is Resource State managed?

One important point about the emulator is its ability to maintain resource state.

Imagine a developer performs the following operations:

- Create an S3 bucket.
- Upload a file to the bucket.
- Send a request to list the objects.
- Download the file that was just uploaded.

If the emulator only returned simulated responses without maintaining state, the later operations could not correctly reflect the results of the earlier ones.

AWS Emulator manages resource state in the memory of the process.

For example, when you create a queue, send a message and then receive messages from that queue, the emulator can maintain the state so that subsequent operations see the results created earlier.

However, this state does not persist after the emulator stops by default. When you need a clean test environment, you can start a new instance.

### 3.4. Isolating test environments

Another notable point is that each AWS Emulator instance has its own port, credentials and state.

This matters when several test suites or several CI jobs need to run in parallel.

For example:

- Test suite A creates the S3 bucket `test-a`.
- Test suite B creates the S3 bucket `test-b`.
- The two test suites run on two different emulator instances.

That way, the data of the two environments is not mixed up or overwritten.

This is a worthwhile advantage when designing Integration Tests that run in parallel in CI/CD.

## 4. AWS Emulator and AWS API Models

A fairly interesting point in the design of AWS Emulator is how it builds its compatibility with AWS.

AWS Emulator uses the API Models published by AWS. These models are also the foundation used when building the AWS SDK.

Specifically, AWS API Models describe the communication contract of the services, including:

- The operations a service supports.
- The request and response structure.
- The data types.
- The required fields.
- The validation rules.
- The errors that can occur.

AWS uses Smithy to model APIs. You can think of it as a way of describing the structure and communication behavior of a service as a model with clear rules.

For example, an API can specify which fields a request needs, the data type of each field, and what structure the response comes back in.

The AWS SDK uses these API models to build the way it communicates with AWS. AWS Emulator also relies on similar models to implement local API handling.

### 4.1. An API Model does not mean a complete simulation of AWS

This is a point that needs distinguishing.

An API Model can describe the request and response structure accurately, but that does not mean the emulator automatically simulates the entire behavior of the service.

For example, an API can be fully described structurally, but the business handling behind it still has to be implemented.

So two concepts need distinguishing:

- **API Compatibility:** The ability to be compatible in terms of protocol and API structure.
- **Behavioral Fidelity:** The degree to which the actual behavior of AWS is accurately simulated.

An emulator can accept a structurally correct request and still not fully handle the complex business rules of the service.

This is also why AWS Emulator has a mechanism for measuring Fidelity instead of simply announcing that an API is supported.

## 5. AWS Emulator Fidelity – Measuring the degree of compatibility with AWS

One of the most notable points of AWS Emulator is how AWS measures the degree of compatibility with real AWS.

AWS calls this concept **Fidelity**.

Instead of just checking whether the emulator receives the request, AWS builds test cases that compare results between the emulator and real AWS.

### 5.1. What is a Fidelity Test?

A Fidelity Test is usually a short program that uses the AWS SDK to perform a specific workflow.

For example, with Amazon S3, a test might perform:

1. Create a bucket.
2. Upload an object.
3. Get the object information.
4. Download the object.
5. Delete the object.
6. Delete the bucket.

After that, the results are compared between real AWS and AWS Emulator.

The comparison is not based only on whether the request succeeded or failed, but also considers:

- HTTP status code.
- Response body.
- Error code.
- Error message.
- Resource state.
- The data created after the workflow runs.

A test is only considered passing when the important results match AWS behavior within the scope being tested.

### 5.2. What does a Fidelity Report mean?

AWS publishes Fidelity results per service and per release.

For example, if a service has 50 tests and 40 pass, the result might be expressed as 40/50.

This number gives developers a clearer view of how well the emulator supports the service they are using.

However, it should not be understood to mean that 80% Fidelity means 80% of every function of the service works completely.

The Fidelity Score reflects the proportion of tests in the evaluation suite that passed, not the absolute coverage ratio of the entire AWS API.

A service can have many supported APIs and still have edge cases that have not been tested.

In addition, the Fidelity Test suite can be extended with each release. So the score can change as the number of tests grows.

### 5.3. Why does Fidelity matter?

With ordinary emulators, developers usually have to check for themselves whether the tool's behavior matches real AWS.

This can create a problem: tests pass locally but fail when running on AWS.

For example:

- Local returns success but real AWS rejects the request.
- Local does not check a required field but AWS requires it.
- Local handles errors differently from AWS.
- Local maintains resource state in a way that does not match the actual behavior.

Fidelity Tests help narrow this gap.

Instead of relying only on documentation or the developer's expectations, AWS has a public test suite to measure the difference between the two environments.

This is a notable approach, especially for systems that depend heavily on the specific behavior of the AWS API.

## 6. How is AWS Emulator different from Mocking?

This is an important point for understanding the real value of AWS Emulator.

When writing Unit Tests, developers usually use Mocks to simulate the behavior of the AWS SDK.

For example, when testing the file upload feature, we can mock the upload method and configure it to always return a successful result.

This approach is very useful for Unit Tests, but it has a limitation: a Mock only reflects what the developer defined.

It does not necessarily reflect how the AWS API actually works.

Imagine the application sends a request with an invalid structure to S3. If the mock is configured to return success, the test still passes even though, when running on real AWS, that request might fail.

AWS Emulator approaches the problem in a different way.

Instead of simulating each SDK method individually, the emulator provides an environment that handles the AWS API. Requests are sent to the emulator and handled according to the logic of the API it supports.

| Criterion | Mocking | AWS Emulator |
| --- | --- | --- |
| Purpose | Simulate a dependency | Simulate the AWS API |
| Request handling | According to the test configuration | According to the supported API |
| Validation | Defined by the developer | Has corresponding validation handling |
| Resource state | Usually has to be managed manually | The emulator manages local state |
| Failure simulation | Flexible per configuration | According to the implemented behavior |
| API integration error detection | Limited | Can detect more errors |
| Speed and isolation | Very suitable for Unit Tests | Suitable for Integration Tests |

This does not mean AWS Emulator completely replaces Mocking.

Mocks are still very suitable for Unit Tests, especially when you need precise control over a specific situation or need to simulate a failure that is hard to reproduce.

AWS Emulator is more suitable when you need to test the interaction between the application and the AWS API.

The two approaches can complement each other within the same testing strategy.

## 7. AWS Emulator vs LocalStack – Two approaches to local AWS

Before AWS Emulator appeared, LocalStack was already one of the popular choices when developers wanted to run AWS Services on the local machine.

So AWS developing a tool with the same goal makes LocalStack a natural point of comparison.

However, the two tools should not be seen as differing only in name. They have differences in approach, feature scope and ecosystem.

### 7.1. What is LocalStack?

<escape>LocalStack</escape> is a platform for simulating Cloud Services that lets developers run many AWS services right on their own machine or in a CI environment.

Instead of having to create resources on real AWS, developers can start LocalStack and use the AWS SDK, AWS CLI or Infrastructure as Code tools to interact with the supported services.

A few services commonly used with LocalStack:

- Amazon S3.
- Amazon SQS.
- Amazon SNS.
- Amazon DynamoDB.
- AWS Lambda.
- Amazon API Gateway.
- Amazon EventBridge.
- AWS Step Functions.

LocalStack is usually deployed through Docker, which suits local development workflows and Integration Tests.

Besides simulating APIs, LocalStack has also developed many more features for the development and testing process, such as state management, Cloud Pods, IaC integration, IAM policy enforcement, sandbox and CI/CD support tools.

### 7.2. Overview comparison

| Criterion | AWS Emulator | LocalStack |
| --- | --- | --- |
| Developer | AWS | LocalStack |
| Main goal | Simulate the AWS API with measured compatibility | Provide a local Cloud environment with a broad feature ecosystem |
| Deployment method | Package on Linux, Docker on macOS/Windows and embedded mode for some cases | Mainly through Docker, the CLI and supported deployment methods |
| AWS SDK / CLI | Supported | Supported |
| API Models | Generate services from AWS API Models | Implement the emulator and services on the LocalStack platform |
| Fidelity | Publish a Fidelity Test suite and results per release | Has its own testing mechanism and coverage documentation |
| Resource state | In-memory, lost when the instance stops | Has persistence and snapshot options depending on version/plan |
| Environment isolation | Each instance has its own port, credentials and state | Has sandbox, instances and isolation features depending on configuration/plan |
| IAM | Does not fully simulate IAM policy like AWS | Has IAM policy enforcement features depending on plan |
| Cross-account / Cross-Region | Not fully supported per the initial limits | Supports multi-account and cross-region scenarios depending on features |
| IaC | Can use the AWS CLI/SDK; the compatibility of each workflow needs checking | Integrates Terraform, CDK, CloudFormation and many IaC tools |
| Cost | No emulator service fee | Has a free plan and paid plans |

A point to note is that the support scope of both tools changes with each version and product plan. The table above describes the approach and the notable capabilities, not a commitment that every API is supported.

### 7.3. Differences in design philosophy

This is the most interesting point when comparing the two tools.

**AWS Emulator: Focused on the AWS API and Fidelity**

AWS Emulator is developed by AWS itself and uses the API Models published by AWS as its foundation.

One of the important goals is to ensure requests are handled as close to real AWS behavior as possible within the supported API scope.

AWS publishes Fidelity Tests so developers can check the compatibility level of each service.

If an operation is not implemented yet, the emulator returns HTTP 501 Not Implemented instead of pretending to handle it successfully.

This approach is fairly clear: it prioritizes transparency about the level of API support and compatibility.

**LocalStack: Focused on the local Cloud environment and the development ecosystem**

LocalStack does not stop at providing an endpoint that simulates the AWS API.

The platform has also developed many features to support the entire application development lifecycle:

- Run and test many AWS Services.
- Integrate Terraform, CDK and IaC tools.
- Manage state through persistence and snapshots.
- Provide sandboxes for developers.
- Integrate with CI/CD.
- Support IAM testing and some security scenarios.
- Advanced observability, debugging and testing tools.

You could say LocalStack aims to provide a local Cloud environment with many conveniences for developers and engineering teams.

### 7.4. Differences in Fidelity and API Coverage

One of the important questions when choosing an emulator is:

**How do I know the API I am using actually behaves like AWS?**

AWS Emulator solves this problem with Fidelity Tests.

Each release has tests that compare results with real AWS. Developers can view the results per service and per workflow.

With LocalStack, developers need to consult Service Coverage, the documentation of each service and the features corresponding to the plan in use.

You should not look only at the number of services advertised. A service can be listed as supported and still have operations or behaviors that are not fully simulated.

So when evaluating the two tools, you should focus on the APIs the application actually uses.

For example, a system that only uses S3, SQS and DynamoDB does not necessarily need an emulator that supports hundreds of services. What matters is whether the specific workflows of that system work correctly.

### 7.5. Differences in state and test environments

AWS Emulator stores resource state in the memory of the process.

When the emulator stops, that state is not retained by default.

This is beneficial for tests that need a clean and easily reproducible environment. Each run can start a new instance without worrying that data from the previous run will affect the results.

Meanwhile, LocalStack has persistence and snapshot features, which allow saving and restoring the environment state according to the capabilities of the version and product plan.

For example, a team can prepare an environment state with buckets, queues and the necessary resources, then reuse it for many test runs.

This is a difference worth considering if the project has complex local environments and needs to keep state between runs.

### 7.6. Differences in IAM and Security Testing

This is a point that deserves special attention.

AWS Emulator does not evaluate IAM Policy and Resource-based Policy the way real AWS does.

A request accepted by the emulator does not mean that request will definitely be accepted by AWS.

LocalStack provides IAM policy enforcement and IAM testing features in some product plans.

This makes LocalStack a better fit for some scenarios that need to check authorization logic in a local environment.

However, even when using LocalStack, local test results should not be seen as sufficient evidence of the system's safety on AWS.

Issues related to IAM, resource policy, trust relationship, network boundary and the real security mechanisms still need to be verified on AWS.

### 7.7. Differences in cost

AWS Emulator has no separate service fee. Developers can use it without paying for running the emulator.

LocalStack currently offers several different plans, including a free Hobby plan for non-commercial purposes and paid plans intended for teams or more complex workloads.

Features such as the number of supported services, persistence, advanced IAM enforcement and sandbox may depend on the plan in use.

So when choosing, you should not compare only which tool is free. You also need to consider the features the project actually needs.

### 7.8. Should you choose AWS Emulator or LocalStack?

There is no single right answer for every project.

You might consider AWS Emulator if:

- You want to use a tool developed by AWS.
- You prioritize compatibility with the AWS API and want to see the Fidelity Report.
- You need a simple local test environment.
- You want to create many independent instances for test suites.
- You do not need to keep resource state after the emulator stops.

You might consider LocalStack if:

- The project uses many AWS Services.
- You need an ecosystem with rich IaC and CI/CD support.
- You want to use persistence or snapshots to reuse the environment.
- You need sandboxes and features that support team development.
- You have a need to test IAM with the features the LocalStack plan in use provides.

A practical approach is to choose the tool based on the workload rather than choosing by brand.

If the project only needs to test a few basic APIs, AWS Emulator might be a lightweight choice. If the project needs a feature-rich local Cloud environment that integrates deeply with the DevOps process, LocalStack is worth considering.

## 8. Situations where you can use AWS Emulator

### 8.1. Local Development

This is one of the most obvious use cases.

Developers can build AWS-related features right on their own machine without constantly creating resources on the Cloud.

For example:

- Develop the file upload and download feature with S3.
- Test producers and consumers with SQS.
- Test data read and write operations with DynamoDB.
- Test the publish and subscribe flow with SNS.

This reduces dependence on the AWS environment during day-to-day development.

### 8.2. Integration Testing

In a backend system, many features depend not only on the database but also integrate with AWS services.

Instead of just mocking the entire AWS SDK, developers can use the emulator to test a more realistic interaction flow.

For example, an order processing flow might include:

1. The application receives a request to create an order.
2. The information is saved to the database.
3. A message is sent to SQS.
4. The worker receives the message and processes it.
5. The result is stored or notified through another AWS service.

AWS Emulator can help test the parts that interact with the AWS APIs it implements.

Thanks to that, developers can catch many bugs that Unit Tests using ordinary mocks struggle to detect.

### 8.3. CI/CD Pipeline

AWS Emulator can also be used in CI/CD.

Instead of having to create resources on AWS every time an Integration Test runs, the pipeline can start a separate emulator instance for each job.

A workflow might include:

- Start the emulator.
- Prepare the endpoint and credentials configuration.
- Create the necessary resources.
- Run the Integration Tests.
- Collect the test results.
- Stop the emulator and release the resources.

Each job can use an independent instance, limiting data conflicts between runs.

This is especially useful when many Pull Requests are being tested at the same time.

### 8.4. Testing with many independent environments

A common problem in Integration Tests is tests sharing the same environment and the same data set.

For example, two tests both create a bucket with the same name or both use the same queue.

When run sequentially, everything might work normally. But when run in parallel, one test might delete a resource another test is using.

Running each test suite on its own emulator instance helps reduce this kind of conflict.

This is also a way to build test environments with a higher degree of isolation.

### 8.5. Training and Onboarding

For developers who are new to the project, getting familiar with AWS sometimes requires many preparation steps.

AWS Emulator can help them get to grips with using the AWS SDK and AWS API right on their own machine, without needing access granted to the organization's AWS account.

This is also a useful option for workshops or learning environments.

## 9. AWS Emulator does not replace real AWS

Even though AWS Emulator aims to simulate the AWS API, it should not be seen as a complete replica of the AWS Cloud.

There are a few limitations to keep in mind.

### 9.1. Not every API is fully supported

AWS has a very large service ecosystem. The emulator's level of support can differ between services and between operations.

For APIs that are not implemented yet, the emulator may return a `501 Not Implemented` error.

So you need to check the Fidelity Report before deciding to use it for a specific project.

### 9.2. It does not replace IAM and Security testing

This is a particularly important limitation.

AWS Emulator does not evaluate IAM Policy and Resource-based Policy the same way real AWS does.

So a request may be accepted by the emulator but rejected by AWS when running in the real environment.

You should not use the emulator to check the safety of IAM configuration, authorization or the security mechanisms on AWS.

### 9.3. Limits on Account and Region

According to the limits AWS published at the time of launch, each emulator instance behaves as a single AWS account.

Behaviors involving cross-account and cross-Region are not yet supported as they are on real AWS.

If the application depends on these features, an additional testing step on the AWS environment is needed.

### 9.4. Resource state is not persisted long-term by default

Resources in the emulator are stored in memory.

When the process stops, this state is no longer maintained.

This suits many testing situations, but it is not suitable if the goal is to maintain a long-lived local environment without an additional storage mechanism.

### 9.5. It does not fully reflect the operational characteristics of the Cloud

An emulator can help test APIs and integration logic, but it cannot fully represent the real AWS environment.

Some issues cannot be assessed accurately with a local emulator alone:

- Network latency between services.
- IAM and the real security policies.
- Throttling and service quotas.
- The availability and fault tolerance of AWS.
- Behavior when an incident occurs in the Cloud infrastructure.
- The resource and performance limits of the production environment.

So Integration Tests on local cannot completely replace Staging Tests or Production-like Tests.

### 9.6. Do not use it for Production

AWS Emulator is designed for Development and Testing.

Production workloads still need to run on real AWS or a suitable deployment environment, where the necessary operational, security, scalability and reliability mechanisms are all in place.

## 10. A combined testing strategy

Instead of choosing between Mocking, AWS Emulator and real AWS, we can use all three at different testing layers.

A testing strategy can be divided into three layers.

**Layer 1 – Unit Test**

Use Mocks to test business logic independently.

For example:

- Check how the code handles a successful file upload.
- Check the retry logic when sending a message fails.
- Check how errors from the AWS SDK are handled.

The goal is to test the logic of the application, without depending on the external environment.

**Layer 2 – Local Integration Test**

Use AWS Emulator or LocalStack to check the ability to interact with the AWS API.

For example:

- Create an S3 bucket and upload a file.
- Send a message to SQS and receive the message back.
- Create a DynamoDB table and perform read and write operations.
- Check workflows that combine several services.

The goal is to test the integration between the application and the APIs the emulator supports.

**Layer 3 – Cloud Integration Test**

Use real AWS in the Development or Staging environment.

This is where you test the issues the emulator cannot fully simulate:

- IAM Policy.
- Resource-based Policy.
- Cross-account access.
- Cross-Region communication.
- Networking.
- Service quota.
- The actual behavior of AWS.

The goal is to verify the application works correctly in an environment close to production.

You can picture this strategy as follows:

| Testing layer | Tool | Goal |
| --- | --- | --- |
| Unit Test | JUnit, Mockito | Verify business logic |
| Local Integration Test | AWS Emulator / LocalStack | Verify interaction with the AWS API |
| Cloud Integration Test | AWS Development / Staging | Verify actual behavior on the Cloud |

This approach reduces the number of tests that have to run on real AWS while still maintaining the necessary level of confidence.

## 11. When should you use AWS Emulator?

Not every project that uses AWS needs AWS Emulator.

You might consider using it when:

- The project integrates many AWS Services and needs frequent testing.
- Developers want to develop locally without depending on an AWS account.
- Integration Tests need to check actual API behavior more than with mocks.
- CI/CD needs an independent test environment for each job.
- The cost and time of creating Cloud resources for testing are issues that need optimizing.
- The team wants to reduce dependence on a shared AWS Development account.

Conversely, if the project only uses a few simple AWS APIs or most tests are already handled well by mocks, adding an emulator may not really be necessary.

Before bringing it into the project, you should evaluate a few factors:

1. Which AWS Services are being used?
2. Are the important APIs supported by the emulator?
3. What is the Fidelity of those workflows currently?
4. Do you need persistence or multi-account?
5. Do the tests need to run in parallel in CI/CD?
6. Are there security requirements that must be checked on real AWS?

Most important is choosing the right tool for each testing layer, instead of trying to fit everything into a single solution.

## 12. Conclusion

AWS Emulator brings a notable approach to the process of developing applications that use AWS.

Instead of depending entirely on the AWS Cloud to test every change, developers can bring part of the AWS API environment local and perform testing operations right on their own machine.

The value is not only in saving cost or reducing deployment time, but also in shortening the development loop: write code, test, get feedback and fix bugs.

What is interesting is that AWS Emulator does not merely provide an endpoint that simulates. AWS also publishes a way to measure Fidelity so developers can assess the compatibility between the emulator and real AWS.

Compared with LocalStack, AWS Emulator takes an approach focused on the AWS API and Fidelity, while LocalStack provides a local cloud ecosystem with many features for development, testing and running the DevOps process.

Each tool has its own strengths and suits different needs.

Of course, the emulator cannot completely replace real AWS. Issues related to IAM, security, networking and the actual behavior of the Cloud still need to be verified in the AWS environment.

But for Local Development and Integration Testing, AWS Emulator is a tool worth exploring and trying out.

**References**

- [AWS Emulator – Official Product Page](https://aws.amazon.com/products/developer-tools/emulator/)
- [AWS Emulator – Official Documentation](https://docs.aws.amazon.com/emulator/)
- [AWS News Blog – Test your applications against AWS locally with AWS Emulator](https://aws.amazon.com/blogs/aws/test-your-applications-against-aws-locally-with-aws-emulator/)
- [AWS Emulator – GitHub Repository](https://github.com/aws/aws-emulator)
- [LocalStack – Official Documentation](https://docs.localstack.cloud/)
- [LocalStack – Pricing and Plans](https://www.localstack.cloud/pricing)
