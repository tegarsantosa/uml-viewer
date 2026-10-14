export interface Example {
  name: string;
  source: string;
}

export const EXAMPLES: Example[] = [
  {
    name: 'Dev tools log factory',
    source: `@startuml
    skinparam linetype ortho
    
class DevToolsLogFactory {
    - logs: Map<Log, Class<?>>
    - DevToolsLogFactory()
    + getLog(source: Class<?>): Log
}

class Listener {
    + onApplicationEvent(event: ApplicationPreparedEvent): void
}

DevToolsLogFactory *-- Listener
@enduml`,
  },
  {
    name: 'Inheritance and interfaces',
    source: `@startuml
interface Shape {
    + area(): double
    + perimeter(): double
}

abstract class AbstractShape {
    # name: String
    + {abstract} area(): double
    + getName(): String
    + {static} create(kind: String): Shape
}

class Circle {
    - radius: double
    + Circle(radius: double)
    + area(): double
    + perimeter(): double
}

class Rectangle {
    - width: double
    - height: double
    + area(): double
    + perimeter(): double
}

enum Color {
    RED
    GREEN
    BLUE
}

Shape <|.. AbstractShape
AbstractShape <|-- Circle
AbstractShape <|-- Rectangle
Rectangle --> Color : fill
@enduml`,
  },
  {
    name: 'Relationships and packages',
    source: `@startuml
package "Order Service" {
    class Order {
        - id: UUID
        - createdAt: Instant
        + total(): Money
    }
    class OrderLine {
        - quantity: int
        + subtotal(): Money
    }
    class Money <<value object>> {
        - amount: BigDecimal
        - currency: Currency
    }
}

package "Catalog" {
    class Product {
        - sku: String
        - name: String
        + price(): Money
    }
}

class Customer {
    - email: String
    + placeOrder(order: Order): void
}

Order "1" *-- "1..*" OrderLine : lines
OrderLine --> "1" Product
Order ..> Money : uses
Customer "1" o-- "*" Order : history

note right of Order
  Aggregate root.
  All changes go through Order.
end note
@enduml`,
  },
  {
    name: 'Generics and compartments',
    source: `@startuml
hide empty members

class Repository<T extends Entity> {
    -- queries --
    + findById(id: Long): Optional<T>
    + findAll(): List<T>
    -- commands --
    + save(entity: T): T
    + delete(entity: T): void
}

class UserRepository {
    + findByEmail(email: String): Optional<User>
}

interface Entity {
    + getId(): Long
}

class User {
    - email: String
    ~ roles: Set<Role>
    + getId(): Long
}

Repository <|-- UserRepository
Entity <|.. User
UserRepository ..> User
@enduml`,
  },
  {
    name: 'Sequence (PlantUML server)',
    source: `@startuml
actor User
participant "Web App" as App
participant "Auth Service" as Auth
database Users

User -> App : login(email, password)
activate App
App -> Auth : authenticate(credentials)
activate Auth
Auth -> Users : findByEmail(email)
Users --> Auth : user
Auth --> App : token
deactivate Auth
App --> User : 200 OK
deactivate App
@enduml`,
  },
];
